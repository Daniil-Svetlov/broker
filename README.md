# Локальная связка фронт ↔ бэк (проверочный стенд)

Фронтенд из ветки `main`, подключённый к **новому** бэкенду (Go quotes-service +
Django REST). Нужен только для проверки работоспособности — **в прод не идёт**,
папка в `.gitignore`. Соответствие старому socket.io-серверу не требуется:

| Было (server.js, socket.io) | Стало (REST)                                   |
|-----------------------------|------------------------------------------------|
| `socket.on('price_update')` | `GET {Go}/price?symbol=PAIR` (опрос ~1с)        |
| `emit('make_trade')`        | `POST {Django}/api/trades/`                     |
| `on('trade_result')`        | `POST /api/trades/<id>/settle/` по истечении    |
| `on('balance_update')`      | `GET /api/accounts/<accountId>/`                |

## Запуск

```bash
# 1. Поднять бэкенд (из корня репозитория)
docker compose up --build        # Postgres + Django :8000 + Go :8090 + settler

# 2. Создать демо-счёт и прописать его UUID в config.js
cd _local-integration
./bootstrap.sh

# 3. Отдать фронтенд на том же :3030, что в браузере
python3 serve.py
# открыть http://localhost:3030/terminal.html
```

Без Docker (локальный Django): `RUN="cd ../django-api && python manage.py" ./bootstrap.sh`.

## Что проверяется

- График тянет живую цену с Go-сервиса (CORS уже разрешён на бэке).
- Кнопки ВЫШЕ/НИЖЕ открывают сделку в Django, баланс списывается.
- По истечении срока сделка закрывается, рисуется итог, баланс обновляется.

`accountId` можно переопределить без правки файла:
`localStorage.setItem('lumit_account_id','<uuid>')` в консоли браузера.

## Пары

Бэкенд отдаёт форекс (`EUR/USD`, `GBP/USD`, `USD/JPY`, …) — в терминале выбраны
они, а не крипта из исходного `main` (там цены брал отдельный socket-сервер).
