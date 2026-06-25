#!/usr/bin/env bash
# Создаёт демо-счёт (User + Pay, баланс $10000) в Django и прописывает его UUID
# в config.js. Запускать ПОСЛЕ того, как поднят бэкенд (docker compose up).
#
#   ./bootstrap.sh                 # через docker compose (контейнер api)
#   RUN="cd ../django-api && python manage.py" ./bootstrap.sh   # локальный Django
set -euo pipefail
cd "$(dirname "$0")"

# Команда запуска manage.py. По умолчанию — внутри контейнера api.
RUN="${RUN:-docker compose -f ../docker-compose.yml exec -T api python manage.py}"

read -r -d '' PY <<'PYEOF' || true
from decimal import Decimal
from trading.models import User, Pay
u, _ = User.objects.get_or_create(
    username="demo",
    defaults={"email": "demo@example.com", "password_hash": "x"},
)
p = Pay.objects.filter(user=u, account_type="DEMO").first()
if p is None:
    p = Pay.objects.create(user=u, account_type="DEMO",
                           balance=Decimal("10000"), currency="USD")
print("ACCOUNT_ID=%s" % p.id)
PYEOF

echo "Создаю/ищу демо-счёт..."
OUT="$($RUN shell -c "$PY")"
ACCOUNT_ID="$(printf '%s\n' "$OUT" | sed -n 's/^ACCOUNT_ID=//p' | tr -d '\r')"

if [ -z "$ACCOUNT_ID" ]; then
  echo "Не удалось получить ACCOUNT_ID. Вывод:" >&2
  printf '%s\n' "$OUT" >&2
  exit 1
fi

# Прописываем UUID в config.js (строка accountId).
sed -i "s/accountId: '[^']*'/accountId: '${ACCOUNT_ID}'/" config.js
echo "OK: accountId=${ACCOUNT_ID} записан в config.js"
echo "Теперь: python3 serve.py  →  http://localhost:3030/terminal.html"
