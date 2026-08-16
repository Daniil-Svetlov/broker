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
    timestamp = serializers.SerializerMethodField()
    expire_at = serializers.SerializerMethodField()

    class Meta:
        model = Trade
        fields = [
            "id",
            "account_id",
            "asset_pair",
            "amount",
            "direction",       # "UP" или "DOWN"
            "entry_price",      # Цена входа (float)
            "exit_price",
            "status",           # "OPEN", "WIN", "LOSS"
            "duration",         # Время в секундах
            "payout",
            "created_at",
            "timestamp",        # Время открытия в Unix Sec (для графика)
            "expire_at",         # Время окончания в Unix Sec
        ]

    def get_timestamp(self, obj):
        # Преобразуем время создания в секунды Unix Timestamp
        return int(obj.created_at.timestamp())

    def get_expire_at(self, obj):
        # Рассчитываем точное время закрытия сделки
        return int(obj.created_at.timestamp()) + obj.duration

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


class RegisterSerializer(serializers.Serializer):
    """Входные данные регистрации (POST /api/register/)."""

    name = serializers.CharField(min_length=4, max_length=50)
    email = serializers.EmailField()
    password = serializers.CharField(min_length=8, write_only=True)


class LoginSerializer(serializers.Serializer):
    """Входные данные входа (POST /api/login/)."""

    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)


class AccountAuthSerializer(serializers.ModelSerializer):
    """Ответ register/login: счёт + данные пользователя для фронта."""

    account_id = serializers.UUIDField(source="id", read_only=True)
    user_id = serializers.UUIDField(source="user.id", read_only=True)
    username = serializers.CharField(source="user.username", read_only=True)
    email = serializers.EmailField(source="user.email", read_only=True)

    class Meta:
        model = Pay
        fields = [
            "account_id",
            "user_id",
            "username",
            "email",
            "account_type",
            "balance",
            "currency",
        ]
