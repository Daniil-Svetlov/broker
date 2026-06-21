-- ВНИМАНИЕ: канонический источник схемы — миграции Django (django-api/trading/migrations).
-- Этот файл оставлен как справка/для standalone-развёртывания Go-сервиса без Django.
-- Держите его в соответствии с моделями trading/models.py.

-- 1. Users
CREATE TABLE users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username    VARCHAR(50) UNIQUE NOT NULL,
    email       VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    date_joined TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Pay 
CREATE TYPE account_type AS ENUM ('DEMO', 'REAL');

CREATE TABLE pay (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_type account_type NOT NULL DEFAULT 'DEMO',
    balance      NUMERIC(18, 2) NOT NULL DEFAULT 0.00,
    currency     VARCHAR(10) NOT NULL DEFAULT 'USD'
);

-- 3. Traders 
CREATE TYPE trade_direction AS ENUM ('UP', 'DOWN');
CREATE TYPE trade_status AS ENUM ('OPEN', 'WIN', 'LOSS');

CREATE TABLE traders (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id   UUID REFERENCES pay(id) ON DELETE CASCADE,
    asset_pair   VARCHAR(20) NOT NULL,
    amount       NUMERIC(18, 2) NOT NULL,
    direction    trade_direction NOT NULL,
    entry_price  NUMERIC(18, 8) NOT NULL,
    exit_price   NUMERIC(18, 8),
    payout       NUMERIC(18, 2) NOT NULL DEFAULT 0,
    status       trade_status NOT NULL DEFAULT 'OPEN',
    duration     INTEGER NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    settled_at   TIMESTAMPTZ
);

-- 4. Transactions
CREATE TYPE transaction_type AS ENUM ('DEPOSIT', 'WITHDRAW', 'BONUS');

CREATE TABLE transactions (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES pay(id) ON DELETE CASCADE,
    amount     NUMERIC(18, 2) NOT NULL,
    type       transaction_type NOT NULL,
    timestamp  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Индексы
CREATE INDEX idx_pay_user_id ON pay(user_id);
CREATE INDEX idx_traders_user_id ON traders(user_id);
CREATE INDEX idx_traders_account_id ON traders(account_id);
CREATE INDEX idx_traders_status ON traders(status);
CREATE INDEX idx_transactions_account_id ON transactions(account_id);

-- 5. Assets (валютные пары)
CREATE TABLE assets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol          VARCHAR(20) UNIQUE NOT NULL,
    name            VARCHAR(100) NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    payout_percent  INTEGER NOT NULL DEFAULT 80
);

-- 6. Quotes (котировки)
CREATE TABLE quotes (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id   UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    bid        NUMERIC(18, 8) NOT NULL,
    ask        NUMERIC(18, 8) NOT NULL,
    timestamp  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_quotes_asset_id ON quotes(asset_id);
CREATE INDEX idx_quotes_timestamp ON quotes(timestamp);

INSERT INTO assets (symbol, name) VALUES
    ('EUR/USD', 'Euro / US Dollar'),
    ('USD/CAD', 'US Dollar / Canadian Dollar'),
    ('GBP/USD', 'British Pound / US Dollar'),
    ('USD/JPY', 'US Dollar / Japanese Yen'),
    ('AUD/USD', 'Australian Dollar / US Dollar'),
    ('USD/CHF', 'US Dollar / Swiss Franc'),
    ('NZD/USD', 'New Zealand Dollar / US Dollar'),
    ('EUR/GBP', 'Euro / British Pound');
