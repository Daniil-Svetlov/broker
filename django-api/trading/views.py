"""REST API брокера (DRF).

Эндпоинты:
  GET  /api/assets/                  — список валютных пар
  GET  /api/accounts/<id>/           — счёт и баланс
  GET  /api/accounts/<id>/trades/    — история сделок счёта
  POST /api/trades/                  — открыть сделку
  GET  /api/trades/<id>/             — сделка
  POST /api/trades/<id>/settle/      — закрыть сделку (force, для ручного/тестов)
  GET  /api/quotes/latest/?symbol=   — живая онлайн-цена пары
"""
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.generics import ListAPIView, RetrieveAPIView
from rest_framework.response import Response

from .models import Asset, Pay, Trade
from .quotes_client import QuotesUnavailable, get_live_price
from .serializers import (
    AccountAuthSerializer,
    AssetSerializer,
    LoginSerializer,
    OpenTradeSerializer,
    PaySerializer,
    RegisterSerializer,
    TradeSerializer,
)
from .services import (
    AuthError,
    TradeError,
    login_user,
    open_trade,
    register_user,
    settle_trade,
)


class AssetListView(ListAPIView):
    queryset = Asset.objects.filter(is_active=True).order_by("symbol")
    serializer_class = AssetSerializer


class AccountView(RetrieveAPIView):
    queryset = Pay.objects.all()
    serializer_class = PaySerializer
    lookup_field = "id"


class AccountTradesView(ListAPIView):
    serializer_class = TradeSerializer

    def get_queryset(self):
        return Trade.objects.filter(account_id=self.kwargs["id"]).order_by("-created_at")


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
