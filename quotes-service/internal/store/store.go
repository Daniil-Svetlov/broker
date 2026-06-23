// Package store инкапсулирует доступ к Postgres: список активных пар и
// запись котировок. Это go-порт SQL-части старого quotes.py.
package store

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Asset struct {
	ID     string
	Symbol string
	Name   string
}

type Store struct {
	pool *pgxpool.Pool
}

func New(ctx context.Context, dsn string) (*Store, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("create pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping db: %w", err)
	}
	return &Store{pool: pool}, nil
}

func (s *Store) Close() { s.pool.Close() }

// InitAssets создаёт записи валютных пар (идемпотентно), как initialize_assets().
// id/is_active/payout_percent проставляем явно: схему владеет Django, а у его
// UUID-полей и полей с default= нет дефолта на уровне БД (значения генерит ORM
// в Python). Поэтому даём БД сгенерить UUID и задаём дефолты сами.
func (s *Store) InitAssets(ctx context.Context, pairs [][2]string) error {
	for _, p := range pairs {
		_, err := s.pool.Exec(ctx,
			`INSERT INTO assets (id, symbol, name, is_active, payout_percent)
			 VALUES (gen_random_uuid(), $1, $2, TRUE, 80)
			 ON CONFLICT (symbol) DO NOTHING`,
			p[0], p[1])
		if err != nil {
			return fmt.Errorf("insert asset %s: %w", p[0], err)
		}
	}
	return nil
}

// ActiveAssets возвращает активные пары для торговли.
func (s *Store) ActiveAssets(ctx context.Context) ([]Asset, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, symbol, name FROM assets WHERE is_active = TRUE ORDER BY symbol`)
	if err != nil {
		return nil, fmt.Errorf("query assets: %w", err)
	}
	defer rows.Close()

	var out []Asset
	for rows.Next() {
		var a Asset
		if err := rows.Scan(&a.ID, &a.Symbol, &a.Name); err != nil {
			return nil, fmt.Errorf("scan asset: %w", err)
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// InsertQuote сохраняет котировку для пары по её символу. id и timestamp
// задаём явно — у Django-полей (UUID PK, auto_now_add) нет дефолта в БД.
func (s *Store) InsertQuote(ctx context.Context, assetID string, bid, ask float64) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO quotes (id, asset_id, bid, ask, timestamp)
		 VALUES (gen_random_uuid(), $1, $2, $3, NOW())`,
		assetID, bid, ask)
	if err != nil {
		return fmt.Errorf("insert quote: %w", err)
	}
	return nil
}
