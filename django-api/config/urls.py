from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("trading.urls")),
    # Фронт просит версионированный префикс — тот же набор ручек под /api/v1/,
    # чтобы можно было мигрировать постепенно и ничего не ломать.
    path("api/v1/", include("trading.urls")),
]
