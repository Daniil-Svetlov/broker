"""Свечи OHLC для графика — агрегация сырых тиков из `quotes`.

Зачем отдельный модуль: в БД лежат только тики bid/ask (Go-сервис пишет их
раз в ~10 с). График, построенный прямо по тикам, получается рваным — между
тиками бывают дыры до 27 с, и линия распадается на куски. Здесь тики
сворачиваются в свечи по фиксированной сетке времени, а пустые интервалы
заполняются предыдущим close, чтобы серия была непрерывной.

Агрегация делается в Postgres: тянуть 100k+ строк в Python ради 300 свечей
неразумно.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from django.db import connection

from .models import Asset

# Допустимые таймфреймы в секундах. Фронт хранит интервал в секундах
# (localStorage `lumit_candle_interval`), поэтому и здесь секунды.
# Ниже 30 с смысла нет — тики приходят раз в ~10 с.
ALLOWED_TIMEFRAMES = (30, 60, 300, 900, 3600)

DEFAULT_TIMEFRAME = 60
DEFAULT_LIMIT = 300
MAX_LIMIT = 1000


class CandleError(Exception):
    """Некорректный запрос свечей (неизвестная пара, неверный таймфрейм)."""


@dataclass(frozen=True)
class Candle:
    t: int          # начало интервала, unix seconds
    o: Decimal
    h: Decimal
    l: Decimal
    c: Decimal
    v: int          # число тиков в интервале (объёма у форекса нет)


_AGGREGATE_SQL = """
    SELECT
        (floor(EXTRACT(EPOCH FROM q.ts) / %(bucket)s) * %(bucket)s)::bigint AS bucket_start,
        (array_agg(q.mid ORDER BY q.ts ASC))[1]  AS o,
        max(q.mid)                                AS h,
        min(q.mid)                                AS l,
        (array_agg(q.mid ORDER BY q.ts DESC))[1] AS c,
        count(*)                                  AS ticks
    FROM (
        SELECT timestamp AS ts, (bid + ask) / 2 AS mid
        FROM quotes
        WHERE asset_id = %(asset_id)s
          AND timestamp >= to_timestamp(%(since)s)
          AND timestamp <  to_timestamp(%(until)s)
    ) q
    GROUP BY 1
    ORDER BY 1
"""

_LAST_BEFORE_SQL = """
    SELECT (bid + ask) / 2
    FROM quotes
    WHERE asset_id = %(asset_id)s AND timestamp < to_timestamp(%(since)s)
    ORDER BY timestamp DESC
    LIMIT 1
"""


def get_history(*, pair: str, timeframe: int, limit: int, until: int) -> list[Candle]:
    """Свечи по паре: `limit` интервалов длиной `timeframe`, заканчивая `until`.

    Пустые интервалы заполняются плоской свечой по предыдущему close —
    поэтому в ответе всегда непрерывная сетка, без дыр.
    """
    if timeframe not in ALLOWED_TIMEFRAMES:
        raise CandleError(
            "допустимые значения tf (сек): " + ", ".join(map(str, ALLOWED_TIMEFRAMES))
        )
    if limit < 1:
        raise CandleError("limit должен быть больше нуля")
    limit = min(limit, MAX_LIMIT)

    try:
        asset_id = Asset.objects.values_list("id", flat=True).get(symbol=pair)
    except Asset.DoesNotExist:
        raise CandleError(f"пара {pair} не найдена")

    # Сетка выравнивается по границе интервала, иначе бакеты «поедут».
    last_bucket = (until // timeframe) * timeframe
    first_bucket = last_bucket - (limit - 1) * timeframe
    params = {
        "bucket": timeframe,
        "asset_id": asset_id,
        "since": first_bucket,
        "until": last_bucket + timeframe,
    }

    with connection.cursor() as cursor:
        cursor.execute(_AGGREGATE_SQL, params)
        rows = {
            int(bucket): (o, h, l, c, ticks)
            for bucket, o, h, l, c, ticks in cursor.fetchall()
        }
        cursor.execute(_LAST_BEFORE_SQL, params)
        seed_row = cursor.fetchone()

    # Чем заполнять дыры в начале: последней ценой до запрошенного окна.
    prev_close = seed_row[0] if seed_row else None

    candles: list[Candle] = []
    for bucket in range(first_bucket, last_bucket + timeframe, timeframe):
        row = rows.get(bucket)
        if row is not None:
            o, h, l, c, ticks = row
            candles.append(Candle(t=bucket, o=o, h=h, l=l, c=c, v=int(ticks)))
            prev_close = c
        elif prev_close is not None:
            # Дыра в данных: плоская свеча, чтобы график не рвался.
            candles.append(
                Candle(t=bucket, o=prev_close, h=prev_close, l=prev_close, c=prev_close, v=0)
            )
        # Если данных ещё вообще не было — свечу не выдумываем, пропускаем.

    return candles
