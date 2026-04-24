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
    asset_pair   VARCHAR(20) NOT NULL,
    amount       NUMERIC(18, 2) NOT NULL,
    direction    trade_direction NOT NULL,
    entry_price  NUMERIC(18, 8) NOT NULL,
    exit_price   NUMERIC(18, 8),
    status       trade_status NOT NULL DEFAULT 'OPEN',
    duration     INTEGER NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
CREATE INDEX idx_traders_status ON traders(status);
CREATE INDEX idx_transactions_account_id ON transactions(account_id);
