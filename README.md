# Broker — бэкенд

Бэкенд платформы бинарных опционов. Состоит из двух сервисов вокруг общей БД
Postgres:

```
┌─────────────────┐   HTTP /price    ┌──────────────────────┐
│  quotes-service │◀─────────────────│   django-api (DRF)    │
│      (Go)       │   живая цена      │  модели + логика      │
│                 │                  │  сделок + REST API    │
└────────┬────────┘                  └───────────┬───────────┘
         │ запись истории котировок               │ счета, сделки, баланс
         ▼                                        ▼
                      ┌──────────────────┐
                      │    PostgreSQL    │
                      └──────────────────┘
```

- **quotes-service (Go)** — go-порт прежнего Python-сервиса `quotes.py`.
  Тянет реальные форекс-курсы онлайн, считает кросс-курсы, держит «живую» цену с
  микро-тиками и отдаёт её по HTTP; параллельно пишет историю в Postgres.
  Подробности — [`quotes-service/README.md`](quotes-service/README.md).
- **django-api (Django + DRF)** — модели (порт `database.py`), REST API и
  **логика сделок** (порт серверной логики из `frontend2/server.js`).
  Цену для открытия/закрытия сделки берёт **онлайн** у Go-сервиса.
  Подробности — [`django-api/README.md`](django-api/README.md).

## Что изменилось относительно старой версии

| Было (Python)                     | Стало                                            |
|-----------------------------------|--------------------------------------------------|
| `quotes.py` (парсинг котировок)   | `quotes-service/` на Go + HTTP API живой цены    |
| `database.py` (наброски моделей)  | полноценный Django-проект `django-api/`          |
| логика сделок на JS (`server.js`) | `django-api/trading/services.py` (Postgres, Decimal, атомарно) |
| `init_assets.py`, `settings.py`   | `quotes -init`, env-конфиг                       |

Канонический источник схемы БД — миграции Django (`django-api/trading/migrations`).
`schema.sql` оставлен как справка для standalone-запуска Go-сервиса без Django.

## Быстрый старт (Docker Compose)

Поднимает Postgres, применяет миграции, запускает Go-сервис, API и закрытие сделок:

```bash
docker compose up --build
```

- API:        http://localhost:8000/api/
- Котировки:  http://localhost:8090/price?symbol=EUR/USD

## Локальный запуск без Docker

```bash
# 1. Postgres
docker run -d --name broker-pg -e POSTGRES_PASSWORD=1234 -e POSTGRES_DB=binary \
  -p 5432:5432 postgres:16

# 2. Django: схема + API
cd django-api
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 0.0.0.0:8000

# 3. Go-сервис котировок (в другом терминале)
cd quotes-service
go run ./cmd/quotes

# 4. Закрытие истёкших сделок (в другом терминале)
cd django-api && source venv/bin/activate
python manage.py settle_trades --watch
```

## Пример сделки

```bash
# создать пользователя и счёт можно через django admin или shell;
# открыть сделку:
curl -X POST http://localhost:8000/api/trades/ -H 'Content-Type: application/json' -d '{
  "account_id": "<uuid счёта>",
  "asset_pair": "EUR/USD",
  "amount": "100.00",
  "direction": "UP",
  "duration": 30
}'
```

Через `duration` секунд `settle_trades` закроет сделку по живой цене и обновит баланс.

## Тесты

```bash
cd quotes-service && go test ./...
cd django-api && DJANGO_TEST_SQLITE=1 python manage.py test trading
```
