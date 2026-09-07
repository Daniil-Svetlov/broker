# broker-web — nginx + статика фронтенда. Контекст сборки — корень репозитория.
# Собирается в CI, публикуется в GHCR; сервер только тянет образ.
FROM nginx:1.27-alpine

# Версия для cache-busting локальных css/js (CI передаёт git sha).
ARG ASSET_VER=dev

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf

# Статика фронта из корня репозитория.
COPY css     /usr/share/nginx/html/css
COPY scripts /usr/share/nginx/html/scripts
COPY *.html  /usr/share/nginx/html/

# Прод-конфиг поверх репозиторного config.js (там адреса localhost для разработки).
COPY deploy/config.prod.js /usr/share/nginx/html/config.js

# Штамп ?v=<sha> на локальные css/js в HTML — Cloudflare/браузер видят новый URL
# на каждом деплое и не отдают старую версию из кеша. Внешние CDN не трогаем.
RUN find /usr/share/nginx/html -maxdepth 1 -name '*.html' -exec \
      sed -i -E 's#(src|href)="(config\.js|css/[^"]+|scripts/[^"]+)"#\1="\2?v='"$ASSET_VER"'"#g' {} +
