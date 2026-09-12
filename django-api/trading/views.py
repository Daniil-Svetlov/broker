"""REST API брокера (DRF).

Эндпоинты:
  GET  /api/assets/                  — список валютных пар
  GET  /api/accounts/<id>/           — счёт и баланс
  GET  /api/accounts/<id>/trades/    — история сделок счёта (?status=, ?limit=)
  POST /api/accounts/<id>/reset/     — сбросить демо-счёт к стартовому балансу
  POST /api/accounts/<id>/password/  — сменить пароль (нужен старый)
  POST /api/trades/                  — открыть сделку
  GET  /api/trades/<id>/             — сделка
  POST /api/trades/<id>/settle/      — закрыть сделку (force, для ручного/тестов)
  GET  /api/chart/history/?pair=&tf= — свечи OHLC для графика
  GET  /api/quotes/latest/?symbol=   — живая онлайн-цена пары
"""
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, throttle_classes
from rest_framework.exceptions import ValidationError
from rest_framework.generics import ListAPIView, RetrieveAPIView
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle

from . import candles
from .models import Asset, Pay, Trade
from .quotes_client import QuotesUnavailable, get_live_price
from .serializers import (
    AccountAuthSerializer,
    AssetSerializer,
    ChangePasswordSerializer,
    LoginSerializer,
    OpenTradeSerializer,
    PaySerializer,
    RegisterSerializer,
    TradeSerializer,
)
from .services import (
    AuthError,
    TradeError,
    change_password,
    login_user,
    open_trade,
    register_user,
    reset_demo_account,
    settle_trade,
)


class DemoResetThrottle(AnonRateThrottle):
    """Ограничение на сброс демо-баланса — чтобы кнопку нельзя было долбить скриптом."""

    scope = "demo_reset"


class PasswordChangeThrottle(AnonRateThrottle):
    """Смена пароля требует старый пароль — ограничиваем перебор."""

    scope = "password_change"


class AssetListView(ListAPIView):
    queryset = Asset.objects.filter(is_active=True).order_by("symbol")
    serializer_class = AssetSerializer


class AccountView(RetrieveAPIView):
    queryset = Pay.objects.all()
    serializer_class = PaySerializer
    lookup_field = "id"


class AccountTradesView(ListAPIView):
    """История сделок счёта, новые сверху.

    ?status=open|closed|win|loss — фильтр. `open` нужен терминалу, чтобы
      сверять маркеры на графике со списком живых сделок.
    ?limit=N — последние N сделок (виджет «последние сделки»), максимум 200.
    """

    serializer_class = TradeSerializer
    MAX_LIMIT = 200

    def get_queryset(self):
        qs = Trade.objects.filter(account_id=self.kwargs["id"]).order_by("-created_at")

        status_param = (self.request.query_params.get("status") or "").strip().upper()
        if status_param == "OPEN":
            qs = qs.filter(status="OPEN")
        elif status_param == "CLOSED":
            qs = qs.exclude(status="OPEN")
        elif status_param in ("WIN", "LOSS"):
            qs = qs.filter(status=status_param)
        elif status_param:
            raise ValidationError({"status": "допустимо: open, closed, win, loss"})

        limit_param = self.request.query_params.get("limit")
        if limit_param:
            try:
                limit = int(limit_param)
            except ValueError:
                raise ValidationError({"limit": "должно быть целым числом"})
            if limit < 1:
                raise ValidationError({"limit": "должно быть больше нуля"})
            qs = qs[: min(limit, self.MAX_LIMIT)]

        return qs


class TradeDetailView(RetrieveAPIView):
    queryset = Trade.objects.all()
    serializer_class = TradeSerializer
    lookup_field = "id"


@api_view(["POST"])
def register_view(request):
    serializer = RegisterSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    try:
        account = register_user(
            name=data["name"], email=data["email"], password=data["password"]
        )
    except AuthError as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(
        AccountAuthSerializer(account).data, status=status.HTTP_201_CREATED
    )


@api_view(["POST"])
def login_view(request):
    serializer = LoginSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    try:
        account = login_user(email=data["email"], password=data["password"])
    except AuthError as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(AccountAuthSerializer(account).data)


@api_view(["POST"])
@throttle_classes([DemoResetThrottle])
def reset_account_view(request, id):
    """Кнопка «Обновить баланс»: демо-счёт обратно к стартовым 10000."""
    try:
        account = reset_demo_account(str(id))
    except TradeError as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(PaySerializer(account).data)


@api_view(["POST"])
@throttle_classes([PasswordChangeThrottle])
def change_password_view(request, id):
    """Смена пароля владельца счёта («Настройки» → «Сменить пароль»)."""
    serializer = ChangePasswordSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    try:
        change_password(
            account_id=str(id),
            old_password=data["old_password"],
            new_password=data["new_password"],
        )
    except AuthError as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["POST"])
def open_trade_view(request):
    serializer = OpenTradeSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    try:
        trade = open_trade(
            account_id=str(data["account_id"]),
            asset_pair=data["asset_pair"],
            amount=data["amount"],
            direction=data["direction"],
            duration=data["duration"],
        )
    except TradeError as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(TradeSerializer(trade).data, status=status.HTTP_201_CREATED)


@api_view(["POST"])
def settle_trade_view(request, id):
    force = str(request.data.get("force", "")).lower() in ("1", "true", "yes")
    try:
        trade = settle_trade(str(id), force=force)
    except Trade.DoesNotExist:
        return Response({"error": "сделка не найдена"}, status=status.HTTP_404_NOT_FOUND)
    except TradeError as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(TradeSerializer(trade).data)


@api_view(["GET"])
def chart_history_view(request):
    """Стартовый пакет свечей для графика — один запрос вместо опроса тиков.

    GET /api/chart/history/?pair=EUR/USD&tf=60&limit=300[&to=<unix>]

    tf — длина свечи в секундах, `to` — правая граница окна (по умолчанию
    сейчас). Пустые интервалы заполнены предыдущим close, поэтому сетка
    непрерывная. `v` — число тиков в свече (объёма у форекса нет).
    """
    pair = (request.query_params.get("pair") or "").strip()
    if not pair:
        return Response(
            {"error": "параметр pair обязателен"}, status=status.HTTP_400_BAD_REQUEST
        )

    try:
        timeframe = int(request.query_params.get("tf") or candles.DEFAULT_TIMEFRAME)
        limit = int(request.query_params.get("limit") or candles.DEFAULT_LIMIT)
        until = int(request.query_params.get("to") or timezone.now().timestamp())
    except ValueError:
        return Response(
            {"error": "tf, limit и to должны быть целыми числами"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        history = candles.get_history(
            pair=pair, timeframe=timeframe, limit=limit, until=until
        )
    except candles.CandleError as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    return Response(
        {
            "pair": pair,
            "tf": timeframe,
            "server_time": int(timezone.now().timestamp()),
            "candles": [
                {"t": c.t, "o": c.o, "h": c.h, "l": c.l, "c": c.c, "v": c.v}
                for c in history
            ],
        }
    )


@api_view(["GET"])
def latest_quote_view(request):
    symbol = request.query_params.get("symbol")
    if not symbol:
        return Response(
            {"error": "параметр symbol обязателен"}, status=status.HTTP_400_BAD_REQUEST
        )
    try:
        bid = get_live_price(symbol, "bid")
        ask = get_live_price(symbol, "ask")
        mid = get_live_price(symbol, "mid")
    except QuotesUnavailable as exc:
        return Response({"error": str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
    return Response({"symbol": symbol, "bid": bid, "ask": ask, "mid": mid})
