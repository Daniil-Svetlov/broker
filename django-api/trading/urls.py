from django.urls import path

from . import views

urlpatterns = [
    path("register/", views.register_view, name="register"),
    path("login/", views.login_view, name="login"),
    path("assets/", views.AssetListView.as_view(), name="asset-list"),
    path("accounts/<uuid:id>/", views.AccountView.as_view(), name="account-detail"),
    path(
        "accounts/<uuid:id>/trades/",
        views.AccountTradesView.as_view(),
        name="account-trades",
    ),
    path("trades/", views.open_trade_view, name="trade-open"),
    path("trades/<uuid:id>/", views.TradeDetailView.as_view(), name="trade-detail"),
    path("trades/<uuid:id>/settle/", views.settle_trade_view, name="trade-settle"),
    path("quotes/latest/", views.latest_quote_view, name="quote-latest"),
]
