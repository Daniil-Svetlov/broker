#!/usr/bin/env bash
# Применить версию образов на сервере. Запускается НА СЕРВЕРЕ — обычно из
# GitHub Actions (job "deploy"), можно и руками. Идемпотентно, с откатом
# по health-check.
#
#   apply.sh <image_tag>        напр.  apply.sh sha-1a2b3c…   или   apply.sh main
#
# Требует: docker login ghcr.io (CI логинится сам), deploy/.env с секретами.
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"

NEW_TAG="${1:?usage: apply.sh <image_tag>}"
ENVF=.env
COMPOSE=(docker compose -f docker-compose.prod.yml)

[ -f "$ENVF" ] || { echo "!! нет $PWD/$ENVF — заполни секреты (см. .env.example)"; exit 1; }

set_tag() {
  if grep -q '^IMAGE_TAG=' "$ENVF"; then sed -i "s|^IMAGE_TAG=.*|IMAGE_TAG=$1|" "$ENVF"
  else printf 'IMAGE_TAG=%s\n' "$1" >> "$ENVF"; fi
}
PREV_TAG="$(sed -n 's/^IMAGE_TAG=//p' "$ENVF" | tail -1)"
PREV_TAG="${PREV_TAG:-main}"

# Профиль tunnel — только если задан токен Cloudflare Tunnel.
PROFILE=()
grep -qE '^CLOUDFLARE_TUNNEL_TOKEN=.+' "$ENVF" && PROFILE=(--profile tunnel)

echo ">> deploy $NEW_TAG  (откат при неудаче → $PREV_TAG)"
set_tag "$NEW_TAG"
"${COMPOSE[@]}" "${PROFILE[@]}" pull
"${COMPOSE[@]}" "${PROFILE[@]}" up -d --remove-orphans

# health-gate: nginx реально отдаёт API и котировки
ok=0
for _ in $(seq 1 30); do
  if curl -fsS -m5 http://localhost/api/assets/ >/dev/null 2>&1 \
  && curl -fsS -m5 'http://localhost/quotes/price?symbol=EUR/USD' >/dev/null 2>&1; then
    ok=1; break
  fi
  sleep 3
done

if [ "$ok" != 1 ]; then
  echo "!! health-check не прошёл за ~90с — откат на $PREV_TAG"
  set_tag "$PREV_TAG"
  "${COMPOSE[@]}" "${PROFILE[@]}" up -d
  "${COMPOSE[@]}" ps
  exit 1
fi

"${COMPOSE[@]}" ps
docker image prune -f >/dev/null 2>&1 || true
echo ">> OK: $NEW_TAG в проде"
