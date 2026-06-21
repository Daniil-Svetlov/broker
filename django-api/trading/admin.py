from django.contrib import admin

from .models import Asset, Pay, Quote, Trade, Transaction, User


@admin.register(User)
class UserAdmin(admin.ModelAdmin):
    list_display = ("username", "email", "date_joined")
    search_fields = ("username", "email")


@admin.register(Pay)
class PayAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "account_type", "balance", "currency")
    list_filter = ("account_type", "currency")


@admin.register(Asset)
class AssetAdmin(admin.ModelAdmin):
    list_display = ("symbol", "name", "is_active", "payout_percent")
    list_filter = ("is_active",)


@admin.register(Quote)
class QuoteAdmin(admin.ModelAdmin):
    list_display = ("asset", "bid", "ask", "timestamp")
    list_filter = ("asset",)


@admin.register(Trade)
class TradeAdmin(admin.ModelAdmin):
    list_display = (
        "asset_pair",
        "direction",
        "amount",
        "status",
        "entry_price",
        "exit_price",
        "payout",
        "created_at",
    )
    list_filter = ("status", "direction", "asset_pair")


@admin.register(Transaction)
class TransactionAdmin(admin.ModelAdmin):
    list_display = ("account", "type", "amount", "timestamp")
    list_filter = ("type",)
