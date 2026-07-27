from django.contrib import admin
from django.urls import include, path
from django.views.decorators.csrf import csrf_exempt

urlpatterns = [
    path("admin/", csrf_exempt(admin.site.urls)),
    path("api/", include("trading.urls")),
]
