"""ORM-модели брокера. Порт database.py.

Отличия от исходного database.py:
  * Trader → Trade (то же имя таблицы `traders`) — понятнее для логики сделок.
  * В Trade добавлен FK `account` (pay): сделка списывает/зачисляет баланс
    конкретного счёта. `user` сохранён (схема требует user_id NOT NULL) и
    проставляется автоматически из account.user.
"""
import uuid

from django.db import models


class User(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    username = models.CharField(max_length=50, unique=True)
    email = models.EmailField(unique=True)
    password_hash = models.CharField(max_length=255)
    date_joined = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "users"

    def __str__(self):
        return self.username


class Pay(models.Model):
    ACCOUNT_TYPES = [("DEMO", "Demo"), ("REAL", "Real")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="accounts")
    account_type = models.CharField(max_length=10, choices=ACCOUNT_TYPES, default="DEMO")
    balance = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    currency = models.CharField(max_length=10, default="USD")

    class Meta:
        db_table = "pay"

    def __str__(self):
        return f"{self.user_id} {self.account_type} {self.balance} {self.currency}"


class Asset(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    symbol = models.CharField(max_length=20, unique=True)
    name = models.CharField(max_length=100)
    is_active = models.BooleanField(default=True)
    payout_percent = models.IntegerField(default=80)

    class Meta:
        db_table = "assets"

    def __str__(self):
        return self.symbol


class Quote(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    asset = models.ForeignKey(Asset, on_delete=models.CASCADE, related_name="quotes")
    bid = models.DecimalField(max_digits=18, decimal_places=8)
    ask = models.DecimalField(max_digits=18, decimal_places=8)
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "quotes"
        ordering = ["-timestamp"]


class Trade(models.Model):
    DIRECTIONS = [("UP", "Up"), ("DOWN", "Down")]
    STATUSES = [("OPEN", "Open"), ("WIN", "Win"), ("LOSS", "Loss")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="trades")
    account = models.ForeignKey(
        Pay, on_delete=models.CASCADE, related_name="trades", null=True, blank=True
    )
    asset_pair = models.CharField(max_length=20)
    amount = models.DecimalField(max_digits=18, decimal_places=2)
    direction = models.CharField(max_length=5, choices=DIRECTIONS)
    entry_price = models.DecimalField(max_digits=18, decimal_places=8)
    exit_price = models.DecimalField(max_digits=18, decimal_places=8, null=True, blank=True)
    payout = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    status = models.CharField(max_length=10, choices=STATUSES, default="OPEN")
    duration = models.IntegerField(help_text="Длительность опциона в секундах")
    created_at = models.DateTimeField(auto_now_add=True)
    settled_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "traders"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.asset_pair} {self.direction} {self.amount} [{self.status}]"


class Transaction(models.Model):
    TYPES = [("DEPOSIT", "Deposit"), ("WITHDRAW", "Withdraw"), ("BONUS", "Bonus")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    account = models.ForeignKey(Pay, on_delete=models.CASCADE, related_name="transactions")
    amount = models.DecimalField(max_digits=18, decimal_places=2)
    type = models.CharField(max_length=10, choices=TYPES)
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "transactions"
        ordering = ["-timestamp"]
