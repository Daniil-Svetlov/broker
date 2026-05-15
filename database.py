import uuid
from django.db import models

class User(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    username = models.CharField(max_length=50, unique=True)
    email = models.EmailField(unique=True)
    password_hash = models.CharField(max_length=255)
    date_joined = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'users'

class Pay(models.Model):
    ACCOUNT_TYPES = [('DEMO', 'Demo'), ('REAL', 'Real')]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='accounts')
    account_type = models.CharField(max_length=10, choices=ACCOUNT_TYPES, default='DEMO')
    balance = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    currency = models.CharField(max_length=10, default='USD')

    class Meta:
        db_table = 'pay'

class Trader(models.Model):
    DIRECTIONS = [('UP', 'Up'), ('DOWN', 'Down')]
    STATUSES = [('OPEN', 'Open'), ('WIN', 'Win'), ('LOSS', 'Loss')]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='trades')
    asset_pair = models.CharField(max_length=20)
    amount = models.DecimalField(max_digits=18, decimal_places=2)
    direction = models.CharField(max_length=5, choices=DIRECTIONS)
    entry_price = models.DecimalField(max_digits=18, decimal_places=8)
    exit_price = models.DecimalField(max_digits=18, decimal_places=8, null=True, blank=True)
    status = models.CharField(max_length=10, choices=STATUSES, default='OPEN')
    duration = models.IntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'traders'

class Asset(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    symbol = models.CharField(max_length=20, unique=True)
    name = models.CharField(max_length=100)
    is_active = models.BooleanField(default=True)
    payout_percent = models.IntegerField(default=80)

    class Meta:
        db_table = 'assets'

class Quote(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    asset = models.ForeignKey(Asset, on_delete=models.CASCADE, related_name='quotes')
    bid = models.DecimalField(max_digits=18, decimal_places=8)
    ask = models.DecimalField(max_digits=18, decimal_places=8)
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'quotes'
        ordering = ['-timestamp']

class Transaction(models.Model):
    TYPES = [('DEPOSIT', 'Deposit'), ('WITHDRAW', 'Withdraw'), ('BONUS', 'Bonus')]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    account = models.ForeignKey(Pay, on_delete=models.CASCADE, related_name='transactions')
    amount = models.DecimalField(max_digits=18, decimal_places=2)
    type = models.CharField(max_length=10, choices=TYPES)
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'transactions'
