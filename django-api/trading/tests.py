"""Тесты логики сделок. Живая цена замокана — Go-сервис для тестов не нужен."""
from decimal import Decimal
from unittest import mock

from django.test import TestCase

from .models import Asset, Pay, Trade, User
from .quotes_client import QuotesUnavailable, get_live_price
from .services import TradeError, open_trade, settle_trade


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
