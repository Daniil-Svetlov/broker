## Стек

- **Python 3.14**
- **PostgreSQL** — основная БД
- **psycopg2** — драйвер PostgreSQL
- **requests** — HTTP-клиент для API котировок

## Структура

```
├── database.py       # Django ORM модели (заготовка для будущего API)
├── quotes.py         # Сервис котировок (API, обновление, получение цен)
├── settings.py       # Конфигурация подключения к БД
├── schema.sql        # SQL схема для PostgreSQL
├── init_assets.py    # Скрипт инициализации валютных пар
└── .gitignore
```

> `venv/` не входит в репозиторий — создаётся локально.

## Модели данных

### users

| Поле | Тип | Описание |
|------|-----|----------|
| id | UUID | Первичный ключ |
| username | VARCHAR(50) | Уникальный логин |
| email | VARCHAR(255) | Уникальный email |
| password_hash | VARCHAR(255) | Хеш пароля |
| date_joined | TIMESTAMPTZ | Дата регистрации |

### pay

| Поле | Тип | Описание |
|------|-----|----------|
| id | UUID | Первичный ключ |
| user_id | UUID (FK → users) | Владелец счёта |
| account_type | ENUM(DEMO, REAL) | Тип счёта |
| balance | NUMERIC(18,2) | Баланс |
| currency | VARCHAR(10) | Валюта счёта, по умолчанию USD |

### assets

| Поле | Тип | Описание |
|------|-----|----------|
| id | UUID | Первичный ключ |
| symbol | VARCHAR(20) | Символ пары (EUR/USD) |
| name | VARCHAR(100) | Полное название |
| is_active | BOOLEAN | Доступна для торговли |
| payout_percent | INTEGER | Процент выплаты, по умолчанию 80 |

### quotes

| Поле | Тип | Описание |
|------|-----|----------|
| id | UUID | Первичный ключ |
| asset_id | UUID (FK → assets) | Валютная пара |
| bid | NUMERIC(18,8) | Цена покупки |
| ask | NUMERIC(18,8) | Цена продажи |
| timestamp | TIMESTAMPTZ | Время котировки |

### traders

| Поле | Тип | Описание |
|------|-----|----------|
| id | UUID | Первичный ключ |
| user_id | UUID (FK → users) | Пользователь |
| asset_pair | VARCHAR(20) | Валютная пара |
| amount | NUMERIC(18,2) | Сумма сделки |
| direction | ENUM(UP, DOWN) | Направление |
| entry_price | NUMERIC(18,8) | Цена входа |
| exit_price | NUMERIC(18,8) | Цена выхода |
| status | ENUM(OPEN, WIN, LOSS) | Статус |
| duration | INTEGER | Длительность в секундах |
| created_at | TIMESTAMPTZ | Время создания |

### transactions

| Поле | Тип | Описание |
|------|-----|----------|
| id | UUID | Первичный ключ |
| account_id | UUID (FK → pay) | Счёт |
| amount | NUMERIC(18,2) | Сумма |
| type | ENUM(DEPOSIT, WITHDRAW, BONUS) | Тип операции |
| timestamp | TIMESTAMPTZ | Время операции |

## Валютные пары

| Символ | Название |
|--------|----------|
| EUR/USD | Euro / US Dollar |
| USD/CAD | US Dollar / Canadian Dollar |
| GBP/USD | British Pound / US Dollar |
| USD/JPY | US Dollar / Japanese Yen |
| AUD/USD | Australian Dollar / US Dollar |
| USD/CHF | US Dollar / Swiss Franc |
| NZD/USD | New Zealand Dollar / US Dollar |
| EUR/GBP | Euro / British Pound |

## Сервис котировок

### API

Используется `https://open.er-api.com/v6/latest/USD` — бесплатный, без ключей и лимитов.

### Функции

| Функция | Описание |
|---------|----------|
| `initialize_assets()` | Создаёт записи валютных пар в БД |
| `fetch_quotes_from_api()` | Получает курсы от провайдера |
| `get_pair_rate(rates, pair)` | Рассчитывает курс (прямой, обратный, кросс-курс) |
| `update_quotes()` | Обновляет котировки для всех активных пар (спред 0.01%) |
| `get_latest_quote(symbol)` | Последняя котировка: `(bid, ask, timestamp)` |
| `get_current_price(symbol, type)` | Цена: `bid` / `ask` / `mid` |

### Использование в коде

```python
from quotes import get_current_price, get_latest_quote

# Текущая mid-цена
price = get_current_price('EUR/USD')

# Цена bid для открытия сделки
bid = get_current_price('EUR/USD', 'bid')

# Полная котировка
quote = get_latest_quote('GBP/USD')
# (Decimal('0.8501'), Decimal('0.8503'), datetime(...))
```

## Развёртывание

### 1. Виртуальное окружение

```bash
python -m venv venv
source venv/bin/activate
pip install psycopg2-binary requests
```

### 2. Создание БД

```bash
sudo -u postgres psql -c 'CREATE DATABASE "binary";'
sudo -u postgres psql -d "binary" -f schema.sql
```

### 3. Настройка подключения

В `settings.py` указать параметры БД:

```python
DB_CONFIG = {
    'dbname': 'binary',
    'user': 'postgres',
    'password': 'YOUR_PASSWORD',
    'host': 'localhost',
    'port': '5432',
}
```

> В продакшене использовать переменные окружения.

### 4. Инициализация и обновление

```bash
# Создать записи валютных пар
venv/bin/python init_assets.py

# Получить актуальные котировки
venv/bin/python -c "from quotes import update_quotes; update_quotes()"
```

## Автоматическое обновление

### Cron

```bash
# Каждую минуту
* * * * * cd /path/to/binary && venv/bin/python -c "from quotes import update_quotes; update_quotes()"
```

### Systemd timer (рекомендуется)

`/etc/systemd/system/quotes-update.service`:
```ini
[Unit]
Description=Update currency quotes

[Service]
Type=oneshot
WorkingDirectory=/path/to/binary
ExecStart=/path/to/binary/venv/bin/python -c "from quotes import update_quotes; update_quotes()"
```

`/etc/systemd/system/quotes-update.timer`:
```ini
[Unit]
Description=Run quotes update every minute

[Timer]
OnUnitActiveSec=1min
OnBootSec=1min

[Install]
WantedBy=timers.target
```

```bash
systemctl enable --now quotes-update.timer
```
