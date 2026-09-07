# broker-web — nginx + статика фронтенда. Контекст сборки — корень репозитория.
# Собирается в CI, публикуется в GHCR; сервер только тянет образ.
FROM nginx:1.27-alpine

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf

# Статика фронта из корня репозитория.
COPY css     /usr/share/nginx/html/css
COPY scripts /usr/share/nginx/html/scripts
COPY *.html  /usr/share/nginx/html/

# Прод-конфиг поверх репозиторного config.js (там адреса localhost для разработки).
COPY deploy/config.prod.js /usr/share/nginx/html/config.js
