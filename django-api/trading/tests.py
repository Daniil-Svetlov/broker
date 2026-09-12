"""Тесты логики сделок. Живая цена замокана — Go-сервис для тестов не нужен."""
from datetime import datetime
from datetime import timezone as dt_timezone
from decimal import Decimal
from unittest import mock, skipUnless

from django.db import connection
from django.test import TestCase

from django.contrib.auth.hashers import check_password, make_password

from .candles import CandleError, get_history
from .models import Asset, Pay, Quote, Trade, User
from .quotes_client import QuotesUnavailable, get_live_price
from .services import (
    AuthError,
    TradeError,
    change_password,
    open_trade,
    reset_demo_account,
    settle_trade,
)


class QuotesClientTest(TestCase):
    """Контракт клиента с ответом Go-сервиса (форма Price из service.go)."""

    def _resp(self, status=200, payload=None):
        m = mock.Mock()
        m.status_code = status
        m.json.return_value = payload or {}
        m.text = ""
        return m

    def test_parses_price_fields(self):
        payload = {
            "symbol": "EUR/USD",
            "bid": 1.0869,
            "ask": 1.0871,
            "mid": 1.0870,
            "timestamp": "2026-06-21T00:00:00Z",
        }
        with mock.patch("trading.quotes_client.requests.get", return_value=self._resp(200, payload)):
            self.assertEqual(get_live_price("EUR/USD", "mid"), Decimal("1.0870"))
            self.assertEqual(get_live_price("EUR/USD", "bid"), Decimal("1.0869"))
            self.assertEqual(get_live_price("EUR/USD", "ask"), Decimal("1.0871"))

    def test_404_raises_unavailable(self):
        with mock.patch("trading.quotes_client.requests.get", return_value=self._resp(404)):
            with self.assertRaises(QuotesUnavailable):
                get_live_price("XXX/YYY")

    def test_network_error_raises_unavailable(self):
        import requests

        with mock.patch(
            "trading.quotes_client.requests.get",
            side_effect=requests.ConnectionError("refused"),
        ):
            with self.assertRaises(QuotesUnavailable):
                get_live_price("EUR/USD")


class TradeLogicTest(TestCase):
    def setUp(self):
        self.user = User.objects.create(
            username="alice", email="alice@example.com", password_hash="x"
        )
        self.account = Pay.objects.create(
            user=self.user, account_type="DEMO", balance=Decimal("1000.00")
        )
        self.asset = Asset.objects.create(
            symbol="EUR/USD", name="Euro / US Dollar", payout_percent=80
        )

    def _open(self, **kwargs):
        params = dict(
            account_id=str(self.account.id),
            asset_pair="EUR/USD",
            amount=Decimal("100"),
            direction="UP",
            duration=60,
        )
        params.update(kwargs)
        return open_trade(**params)

    def test_open_deducts_balance_and_fixes_entry(self):
        with mock.patch("trading.services.get_live_price", return_value=Decimal("1.10000000")):
            trade = self._open()
        self.account.refresh_from_db()
        self.assertEqual(self.account.balance, Decimal("900.00"))
        self.assertEqual(trade.status, "OPEN")
        self.assertEqual(trade.entry_price, Decimal("1.10000000"))

    def test_open_rejects_insufficient_funds(self):
        with mock.patch("trading.services.get_live_price", return_value=Decimal("1.1")):
            with self.assertRaises(TradeError):
                self._open(amount=Decimal("5000"))

    def test_open_accepts_js_style_direction(self):
        with mock.patch("trading.services.get_live_price", return_value=Decimal("1.1")):
            trade = self._open(direction="higher")
        self.assertEqual(trade.direction, "UP")

    def test_win_pays_stake_plus_profit(self):
        # UP, цена выросла -> выигрыш. Выплата = 100 * (1 + 0.80) = 180.
        with mock.patch("trading.services.get_live_price", return_value=Decimal("1.10")):
            trade = self._open(direction="UP")
        with mock.patch("trading.services.get_live_price", return_value=Decimal("1.20")):
            trade = settle_trade(str(trade.id), force=True)
        self.account.refresh_from_db()
        self.assertEqual(trade.status, "WIN")
        self.assertEqual(trade.payout, Decimal("180.00"))
        # 1000 - 100 (ставка) + 180 (выплата) = 1080.
        self.assertEqual(self.account.balance, Decimal("1080.00"))

    def test_loss_keeps_stake_deducted(self):
        with mock.patch("trading.services.get_live_price", return_value=Decimal("1.10")):
            trade = self._open(direction="UP")
        with mock.patch("trading.services.get_live_price", return_value=Decimal("1.05")):
            trade = settle_trade(str(trade.id), force=True)
        self.account.refresh_from_db()
        self.assertEqual(trade.status, "LOSS")
        self.assertEqual(trade.payout, Decimal("0"))
        self.assertEqual(self.account.balance, Decimal("900.00"))

    def test_tie_is_loss(self):
        with mock.patch("trading.services.get_live_price", return_value=Decimal("1.10")):
            trade = self._open(direction="UP")
        with mock.patch("trading.services.get_live_price", return_value=Decimal("1.10")):
            trade = settle_trade(str(trade.id), force=True)
        self.assertEqual(trade.status, "LOSS")

    def test_settle_is_idempotent(self):
        with mock.patch("trading.services.get_live_price", return_value=Decimal("1.10")):
            trade = self._open(direction="UP")
        with mock.patch("trading.services.get_live_price", return_value=Decimal("1.20")):
            settle_trade(str(trade.id), force=True)
            again = settle_trade(str(trade.id), force=True)
        self.account.refresh_from_db()
        self.assertEqual(again.status, "WIN")
        # Повторное закрытие не начисляет выплату второй раз.
        self.assertEqual(self.account.balance, Decimal("1080.00"))


class ResetDemoBalanceTest(TestCase):
    def setUp(self):
        self.user = User.objects.create(
            username="bob", email="bob@example.com", password_hash="x"
        )

    def test_reset_returns_demo_to_start_balance(self):
        account = Pay.objects.create(
            user=self.user, account_type="DEMO", balance=Decimal("42.00")
        )
        reset_demo_account(str(account.id))
        account.refresh_from_db()
        self.assertEqual(account.balance, Decimal("10000.00"))

    def test_reset_also_works_when_balance_is_above_start(self):
        account = Pay.objects.create(
            user=self.user, account_type="DEMO", balance=Decimal("99999.00")
        )
        reset_demo_account(str(account.id))
        account.refresh_from_db()
        self.assertEqual(account.balance, Decimal("10000.00"))

    def test_reset_refuses_real_account(self):
        account = Pay.objects.create(
            user=self.user, account_type="REAL", balance=Decimal("5.00")
        )
        with self.assertRaises(TradeError):
            reset_demo_account(str(account.id))
        account.refresh_from_db()
        self.assertEqual(account.balance, Decimal("5.00"))

    def test_reset_unknown_account_raises(self):
        with self.assertRaises(TradeError):
            reset_demo_account("00000000-0000-0000-0000-000000000000")


class AccountTradesFilterTest(TestCase):
    """Фильтры ?status= и ?limit= — на них опирается терминал."""

    def setUp(self):
        self.user = User.objects.create(
            username="carol", email="carol@example.com", password_hash="x"
        )
        self.account = Pay.objects.create(
            user=self.user, account_type="DEMO", balance=Decimal("1000.00")
        )
        for status_value in ("OPEN", "OPEN", "WIN", "LOSS"):
            Trade.objects.create(
                user=self.user,
                account=self.account,
                asset_pair="EUR/USD",
                amount=Decimal("10"),
                direction="UP",
                entry_price=Decimal("1.1"),
                status=status_value,
                duration=60,
            )
        self.url = f"/api/accounts/{self.account.id}/trades/"

    def test_returns_all_by_default(self):
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()), 4)

    def test_status_open_returns_only_open(self):
        response = self.client.get(self.url, {"status": "open"})
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(len(body), 2)
        self.assertTrue(all(t["status"] == "OPEN" for t in body))

    def test_status_closed_excludes_open(self):
        response = self.client.get(self.url, {"status": "closed"})
        body = response.json()
        self.assertEqual(len(body), 2)
        self.assertFalse(any(t["status"] == "OPEN" for t in body))

    def test_limit_caps_result(self):
        response = self.client.get(self.url, {"limit": "1"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()), 1)

    def test_unknown_status_is_rejected(self):
        response = self.client.get(self.url, {"status": "banana"})
        self.assertEqual(response.status_code, 400)

    def test_non_numeric_limit_is_rejected(self):
        response = self.client.get(self.url, {"limit": "many"})
        self.assertEqual(response.status_code, 400)


class CandleValidationTest(TestCase):
    """Проверки, которые срабатывают до обращения к БД — идут на любой СУБД."""

    def test_rejects_unknown_timeframe(self):
        with self.assertRaises(CandleError):
            get_history(pair="EUR/USD", timeframe=7, limit=10, until=1_700_000_000)

    def test_rejects_zero_limit(self):
        with self.assertRaises(CandleError):
            get_history(pair="EUR/USD", timeframe=60, limit=0, until=1_700_000_000)

    def test_rejects_unknown_pair(self):
        with self.assertRaises(CandleError):
            get_history(pair="XXX/YYY", timeframe=60, limit=10, until=1_700_000_000)


@skipUnless(connection.vendor == "postgresql", "агрегация свечей написана на SQL Postgres")
class CandleAggregationTest(TestCase):
    """Свечи собираются из тиков по фиксированной сетке, дыры заполняются."""

    BASE = 1_700_000_000  # кратно 60, чтобы сетка была ровной

    def setUp(self):
        self.asset = Asset.objects.create(symbol="EUR/USD", name="Euro / US Dollar")

    def _tick(self, offset_sec, mid):
        """Тик со сдвигом от BASE. timestamp у модели auto_now_add — правим update-ом."""
        quote = Quote.objects.create(
            asset=self.asset, bid=Decimal(mid) - Decimal("0.0001"), ask=Decimal(mid) + Decimal("0.0001")
        )
        Quote.objects.filter(id=quote.id).update(
            timestamp=datetime.fromtimestamp(self.BASE + offset_sec, tz=dt_timezone.utc)
        )

    def test_ohlc_is_computed_from_ticks_in_bucket(self):
        # Одна минута, четыре тика: open=1.10, high=1.13, low=1.09, close=1.11
        for offset, mid in ((0, "1.10"), (10, "1.13"), (20, "1.09"), (30, "1.11")):
            self._tick(offset, mid)

        candles = get_history(
            pair="EUR/USD", timeframe=60, limit=1, until=self.BASE + 59
        )
        self.assertEqual(len(candles), 1)
        candle = candles[0]
        self.assertEqual(candle.t, self.BASE)
        self.assertAlmostEqual(float(candle.o), 1.10, places=4)
        self.assertAlmostEqual(float(candle.h), 1.13, places=4)
        self.assertAlmostEqual(float(candle.l), 1.09, places=4)
        self.assertAlmostEqual(float(candle.c), 1.11, places=4)
        self.assertEqual(candle.v, 4)

    def test_gap_is_filled_with_previous_close(self):
        # Тики только в первой и третьей минуте — вторая должна быть заполнена.
        self._tick(0, "1.10")
        self._tick(120, "1.20")

        candles = get_history(
            pair="EUR/USD", timeframe=60, limit=3, until=self.BASE + 179
        )
        self.assertEqual(len(candles), 3)
        filler = candles[1]
        self.assertEqual(filler.v, 0, "у заполненной свечи нет тиков")
        self.assertEqual(filler.o, filler.h)
        self.assertEqual(filler.h, filler.l)
        self.assertEqual(filler.l, filler.c)
        self.assertAlmostEqual(float(filler.c), 1.10, places=4, msg="должен быть предыдущий close")

    def test_grid_is_continuous_and_ordered(self):
        self._tick(0, "1.10")
        candles = get_history(
            pair="EUR/USD", timeframe=60, limit=5, until=self.BASE + 299
        )
        times = [c.t for c in candles]
        self.assertEqual(times, sorted(times), "свечи должны идти по возрастанию времени")
        steps = {b - a for a, b in zip(times, times[1:])}
        self.assertEqual(steps, {60}, "сетка должна быть без разрывов")

    def test_no_data_at_all_returns_empty(self):
        candles = get_history(
            pair="EUR/USD", timeframe=60, limit=5, until=self.BASE + 299
        )
        self.assertEqual(candles, [], "цены выдумывать нельзя")


class ChangePasswordTest(TestCase):
    def setUp(self):
        self.user = User.objects.create(
            username="dave",
            email="dave@example.com",
            password_hash=make_password("OldPass123"),
        )
        self.account = Pay.objects.create(
            user=self.user, account_type="DEMO", balance=Decimal("10000.00")
        )

    def test_changes_password_when_old_one_matches(self):
        change_password(
            account_id=str(self.account.id),
            old_password="OldPass123",
            new_password="BrandNew456",
        )
        self.user.refresh_from_db()
        self.assertTrue(check_password("BrandNew456", self.user.password_hash))

    def test_rejects_wrong_old_password(self):
        with self.assertRaises(AuthError):
            change_password(
                account_id=str(self.account.id),
                old_password="NotTheOldOne",
                new_password="BrandNew456",
            )
        self.user.refresh_from_db()
        self.assertTrue(check_password("OldPass123", self.user.password_hash))

    def test_rejects_same_password(self):
        with self.assertRaises(AuthError):
            change_password(
                account_id=str(self.account.id),
                old_password="OldPass123",
                new_password="OldPass123",
            )

    def test_rejects_unknown_account(self):
        with self.assertRaises(AuthError):
            change_password(
                account_id="00000000-0000-0000-0000-000000000000",
                old_password="OldPass123",
                new_password="BrandNew456",
            )

    def test_endpoint_enforces_min_length(self):
        response = self.client.post(
            f"/api/accounts/{self.account.id}/password/",
            {"old_password": "OldPass123", "new_password": "short"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)

    def test_endpoint_returns_204_on_success(self):
        response = self.client.post(
            f"/api/accounts/{self.account.id}/password/",
            {"old_password": "OldPass123", "new_password": "BrandNew456"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 204)
