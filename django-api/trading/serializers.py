from rest_framework import serializers

from .models import Asset, Pay, Quote, Trade, Transaction, User


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "username", "email", "date_joined"]


class PaySerializer(serializers.ModelSerializer):
    class Meta:
        model = Pay
        fields = ["id", "user", "account_type", "balance", "currency"]


class AssetSerializer(serializers.ModelSerializer):
    class Meta:
        model = Asset
        fields = ["id", "symbol", "name", "is_active", "payout_percent"]


class QuoteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Quote
        fields = ["id", "asset", "bid", "ask", "timestamp"]


class TradeSerializer(serializers.ModelSerializer):
    class Meta:
        model = Trade
        fields = [
            "id",
            "user",
            "account",
            "asset_pair",
            "amount",
            "direction",
            "entry_price",
            "exit_price",
            "payout",
            "status",
            "duration",
            "created_at",
            "settled_at",
        ]


class OpenTradeSerializer(serializers.Serializer):
    """Входные данные на открытие сделки (POST /api/trades/)."""

    account_id = serializers.UUIDField()
    asset_pair = serializers.CharField(max_length=20)
    amount = serializers.DecimalField(max_digits=18, decimal_places=2, min_value=0)
    direction = serializers.CharField(max_length=10)  # UP/DOWN или higher/lower
    duration = serializers.IntegerField(min_value=1)


class TransactionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Transaction
        fields = ["id", "account", "amount", "type", "timestamp"]
