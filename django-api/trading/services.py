"""Логика сделок (бинарные опционы).

Порт серверной логики из frontend2/server.js на Django + Postgres:
  * открытие сделки: проверка баланса, списание ставки, фиксация цены входа;
  * закрытие по истечении времени: расчёт WIN/LOSS по живой цене, выплата.

Отличия от JS-версии:
  * деньги — Decimal, операции со счётом атомарны (transaction.atomic +
    select_for_update), без гонок на балансе;
  * процент выплаты берётся из asset.payout_percent (в JS было захардкожено 85%);
  * цена входа/выхода берётся ОНЛАЙН из Go-сервиса котировок.
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from typing import Optional

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from .models import Asset, Pay, Trade
from .quotes_client import QuotesUnavailable, get_live_price

CENTS = Decimal("0.01")


class TradeError(Exception):
    """Доменная ошибка сделки (некорректные данные, нет средств и т.п.)."""


def _money(value: Decimal) -> Decimal:
    return value.quantize(CENTS, rounding=ROUND_HALF_UP)


def _normalize_direction(direction: str) -> str:
    """Принимает UP/DOWN или higher/lower (как в JS), приводит к UP/DOWN."""
    d = (direction or "").strip().lower()
    if d in ("up", "higher", "call", "buy"):
        return "UP"
    if d in ("down", "lower", "put", "sell"):
        return "DOWN"
    raise TradeError(f"неизвестное направление: {direction!r}")


@transaction.atomic
def open_trade(
    *,
    account_id: str,
    asset_pair: str,
    amount: Decimal,
    direction: str,
    duration: int,
) -> Trade:
    """Открывает сделку: проверяет средства, списывает ставку, фиксирует вход."""
    direction = _normalize_direction(direction)
    amount = _money(Decimal(amount))

    if amount <= 0:
        raise TradeError("сумма сделки должна быть больше нуля")
    if duration < settings.TRADE_MIN_DURATION or duration > settings.TRADE_MAX_DURATION:
        raise TradeError(
            f"длительность должна быть от {settings.TRADE_MIN_DURATION} "
            f"до {settings.TRADE_MAX_DURATION} секунд"
        )

    try:
        asset = Asset.objects.get(symbol=asset_pair, is_active=True)
    except Asset.DoesNotExist:
        raise TradeError(f"пара {asset_pair} недоступна для торговли")

    # Блокируем счёт на время изменения баланса.
    try:
        account = Pay.objects.select_for_update().get(id=account_id)
    except Pay.DoesNotExist:
        raise TradeError("счёт не найден")

    if amount > account.balance:
        raise TradeError("недостаточно средств")

    # Цена входа — живая онлайн-цена.
    try:
        entry_price = get_live_price(asset_pair, "mid")
    except QuotesUnavailable as exc:
        raise TradeError(str(exc)) from exc

    account.balance = _money(account.balance - amount)
    account.save(update_fields=["balance"])

    return Trade.objects.create(
        user_id=account.user_id,
        account=account,
        asset_pair=asset_pair,
        amount=amount,
        direction=direction,
        entry_price=entry_price,
        status="OPEN",
        duration=duration,
    )


def is_due(trade: Trade) -> bool:
    """Истёк ли срок открытой сделки."""
    if trade.status != "OPEN":
        return False
    expires_at = trade.created_at + timezone.timedelta(seconds=trade.duration)
    return timezone.now() >= expires_at


@transaction.atomic
def settle_trade(trade_id: str, *, force: bool = False) -> Trade:
    """Закрывает сделку: считает WIN/LOSS по живой цене, начисляет выплату.

    Идемпотентна: уже закрытую сделку возвращает как есть.
    force=True закрывает досрочно (для ручного закрытия/тестов).
    """
    trade = Trade.objects.select_for_update().get(id=trade_id)
    if trade.status != "OPEN":
        return trade
    if not force and not is_due(trade):
        return trade

    try:
        exit_price = get_live_price(trade.asset_pair, "mid")
    except QuotesUnavailable as exc:
        raise TradeError(str(exc)) from exc

    if trade.direction == "UP":
        is_win = exit_price > trade.entry_price
    else:
        is_win = exit_price < trade.entry_price

    payout = Decimal("0")
    if is_win:
        payout_percent = (
            Asset.objects.filter(symbol=trade.asset_pair)
            .values_list("payout_percent", flat=True)
            .first()
            or 0
        )
        # Возврат ставки + прибыль: amount * (1 + payout%/100).
        factor = Decimal(1) + Decimal(payout_percent) / Decimal(100)
        payout = _money(trade.amount * factor)

        if trade.account_id:
            account = Pay.objects.select_for_update().get(id=trade.account_id)
            account.balance = _money(account.balance + payout)
            account.save(update_fields=["balance"])

    trade.exit_price = exit_price
    trade.payout = payout
    trade.status = "WIN" if is_win else "LOSS"
    trade.settled_at = timezone.now()
    trade.save(update_fields=["exit_price", "payout", "status", "settled_at"])
    return trade


def settle_due_trades() -> int:
    """Закрывает все открытые сделки с истёкшим сроком. Возвращает их число."""
    settled = 0
    open_ids = list(Trade.objects.filter(status="OPEN").values_list("id", flat=True))
    for trade_id in open_ids:
        trade = Trade.objects.get(id=trade_id)
        if is_due(trade):
            settle_trade(trade_id)
            settled += 1
    return settled
