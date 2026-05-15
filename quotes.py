import requests
import psycopg2
from settings import DB_CONFIG

CURRENCY_PAIRS = [
    ('EUR/USD', 'Euro / US Dollar'),
    ('USD/CAD', 'US Dollar / Canadian Dollar'),
    ('GBP/USD', 'British Pound / US Dollar'),
    ('USD/JPY', 'US Dollar / Japanese Yen'),
    ('AUD/USD', 'Australian Dollar / US Dollar'),
    ('USD/CHF', 'US Dollar / Swiss Franc'),
    ('NZD/USD', 'New Zealand Dollar / US Dollar'),
    ('EUR/GBP', 'Euro / British Pound'),
]

def get_connection():
    return psycopg2.connect(
        dbname=DB_CONFIG['dbname'],
        user=DB_CONFIG['user'],
        password=DB_CONFIG['password'],
        host=DB_CONFIG['host'],
        port=DB_CONFIG['port']
    )

def initialize_assets():
    conn = get_connection()
    cur = conn.cursor()
    for symbol, name in CURRENCY_PAIRS:
        cur.execute(
            "INSERT INTO assets (symbol, name) VALUES (%s, %s) ON CONFLICT (symbol) DO NOTHING",
            (symbol, name)
        )
    conn.commit()
    cur.close()
    conn.close()
    print("Assets initialized successfully")

def fetch_quotes_from_api():
    response = requests.get('https://open.er-api.com/v6/latest/USD')
    response.raise_for_status()
    return response.json().get('rates', {})

def get_pair_rate(rates, pair):
    base, quote = pair.split('/')
    base_rate = rates.get(base)
    quote_rate = rates.get(quote)
    
    if base_rate is None or quote_rate is None:
        print(f"Skipping {pair}: rate not found in API")
        return None
        
    if base == 'USD':
        return quote_rate
    elif quote == 'USD':
        return 1 / base_rate
    else:
        return base_rate / quote_rate

def update_quotes():
    rates = fetch_quotes_from_api()
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT id, symbol FROM assets WHERE is_active = TRUE")
    assets = cur.fetchall()
    for asset_id, symbol in assets:
        rate = get_pair_rate(rates, symbol)
        if rate:
            spread = rate * 0.0001
            cur.execute(
                "INSERT INTO quotes (asset_id, bid, ask) VALUES (%s, %s, %s)",
                (asset_id, rate - spread, rate + spread)
            )
    conn.commit()
    cur.close()
    conn.close()
    print("Quotes updated successfully")

def get_latest_quote(symbol):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        """SELECT q.bid, q.ask, q.timestamp 
           FROM quotes q 
           JOIN assets a ON q.asset_id = a.id 
           WHERE a.symbol = %s 
           ORDER BY q.timestamp DESC LIMIT 1""",
        (symbol,)
    )
    result = cur.fetchone()
    cur.close()
    conn.close()
    return result

def get_current_price(symbol, price_type='mid'):
    quote = get_latest_quote(symbol)
    if not quote:
        return None
    bid, ask, _ = quote
    if price_type == 'bid':
        return bid
    elif price_type == 'ask':
        return ask
    return (bid + ask) / 2
