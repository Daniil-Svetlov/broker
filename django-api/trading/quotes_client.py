"""Клиент к Go-сервису котировок.

Сделка открывается и закрывается по ЖИВОЙ онлайн-цене, которую отдаёт
Go-сервис (`GET /price?symbol=...`), а не по снапшоту из таблицы quotes.
"""
from decimal import Decimal

import requests
from django.conf import settings


class QuotesUnavailable(Exception):
    """Go-сервис котировок недоступен или не знает такой пары."""


def get_live_price(symbol: str, price_type: str = "mid") -> Decimal:
    """Возвращает живую цену пары: 'bid' / 'ask' / 'mid' (по умолчанию mid).

    Аналог get_current_price() из старого quotes.py, но цена берётся онлайн.
    """
    url = f"{settings.QUOTES_SERVICE_URL.rstrip('/')}/price"
    try:
        resp = requests.get(
            url, params={"symbol": symbol}, timeout=settings.QUOTES_SERVICE_TIMEOUT
        )
    except requests.RequestException as exc:
        raise QuotesUnavailable(f"сервис котировок недоступен: {exc}") from exc

    if resp.status_code == 404:
        raise QuotesUnavailable(f"нет котировки для пары {symbol}")
    if resp.status_code != 200:
        raise QuotesUnavailable(
            f"сервис котировок вернул {resp.status_code}: {resp.text[:200]}"
        )

    data = resp.json()
    key = price_type if price_type in ("bid", "ask", "mid") else "mid"
    value = data.get(key)
    if value is None:
        raise QuotesUnavailable(f"в ответе нет поля {key}")
    # Decimal из str, чтобы не тащить погрешность float в денежные расчёты.
    return Decimal(str(value))
