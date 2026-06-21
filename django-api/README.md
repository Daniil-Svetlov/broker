# django-api

Бэкенд брокера на Django + DRF: модели, REST API и **логика сделок** (бинарные
опционы) — порт серверной логики из `frontend2/server.js` на Postgres.

## Логика сделок (trading/services.py)

- `open_trade(...)` — проверяет средства, списывает ставку со счёта, фиксирует
  цену входа (живая онлайн-цена из Go-сервиса). Атомарно, с блокировкой счёта.
- `settle_trade(trade_id, force=False)` — по истечении срока берёт живую цену,
  определяет WIN/LOSS, начисляет выплату `ставка * (1 + payout%/100)`.
  Идемпотентна.
- `settle_due_trades()` — закрывает все открытые сделки с истёкшим сроком.

Отличия от JS-версии: деньги в `Decimal`, операции со счётом атомарны (без гонок),
процент выплаты берётся из `asset.payout_percent`, цена — онлайн из Go-сервиса.

## REST API

| Метод | Путь                              | Назначение                       |
|-------|-----------------------------------|----------------------------------|
| GET   | `/api/assets/`                    | список валютных пар              |
| GET   | `/api/accounts/<id>/`             | счёт и баланс                    |
| GET   | `/api/accounts/<id>/trades/`      | история сделок счёта             |
| POST  | `/api/trades/`                    | открыть сделку                   |
| GET   | `/api/trades/<id>/`               | сделка                           |
| POST  | `/api/trades/<id>/settle/`        | закрыть сделку (`{"force":true}`)|
| GET   | `/api/quotes/latest/?symbol=`     | живая онлайн-цена пары           |

Тело `POST /api/trades/`:

```json
{
  "account_id": "<uuid>",
  "asset_pair": "EUR/USD",
  "amount": "100.00",
  "direction": "UP",        // принимает и higher/lower как в JS
  "duration": 60
}
```

## Закрытие истёкших сделок

В JS закрытие висело на `setTimeout`. Здесь это отдельная задача:

```bash
python manage.py settle_trades            # один прогон (cron/таймер)
python manage.py settle_trades --watch    # демон, опрос каждую секунду
```

## Запуск (локально)

```bash
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
export DB_HOST=localhost DB_NAME=binary DB_USER=postgres DB_PASSWORD=1234
export QUOTES_SERVICE_URL=http://localhost:8090
python manage.py migrate
python manage.py runserver 0.0.0.0:8000
```

## Тесты

```bash
DJANGO_TEST_SQLITE=1 python manage.py test trading   # быстро, in-memory SQLite
python manage.py test trading                        # против Postgres
```

> Аутентификация в демо опущена (DRF `AllowAny`, счёт передаётся явным
> `account_id`). Для прода — прикрутить токены/сессии и проверку владельца счёта.
