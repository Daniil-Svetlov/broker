// Package config загружает настройки сервиса из переменных окружения.
// Значения по умолчанию совпадают со старым settings.py, чтобы сервис
// заводился «из коробки» в dev-окружении.
package config

import (
	"fmt"
	"os"
	"time"
)

type Config struct {
	// Postgres
	DBHost     string
	DBPort     string
	DBName     string
	DBUser     string
	DBPassword string

	// HTTP API сервиса котировок
	HTTPAddr string

	// Источник котировок
	RatesAPIURL string

	// Периоды фоновых задач
	BaseRefreshInterval time.Duration // как часто перечитываем реальный базовый курс
	TickInterval        time.Duration // как часто двигаем «живую» цену (микро-тики)
	PersistInterval     time.Duration // как часто пишем котировки в Postgres

	// Волатильность симуляции тиков (доля от цены за тик), напр. 0.0001 = 1 пункт
	TickVolatility float64
	// Спред в долях от цены (0.0001 = 0.01%), как в исходном quotes.py
	Spread float64
	// Вероятность смены тренда за тик (модель market.CalculateNextPrice)
	TrendChangeChance float64
}

func Load() Config {
	return Config{
		DBHost:     env("DB_HOST", "localhost"),
		DBPort:     env("DB_PORT", "5432"),
		DBName:     env("DB_NAME", "binary"),
		DBUser:     env("DB_USER", "postgres"),
		DBPassword: env("DB_PASSWORD", "1234"),

		HTTPAddr:    env("HTTP_ADDR", ":8090"),
		RatesAPIURL: env("RATES_API_URL", "https://open.er-api.com/v6/latest/USD"),

		BaseRefreshInterval: envDuration("BASE_REFRESH_INTERVAL", 5*time.Minute),
		TickInterval:        envDuration("TICK_INTERVAL", time.Second),
		PersistInterval:     envDuration("PERSIST_INTERVAL", 10*time.Second),

		TickVolatility:    envFloat("TICK_VOLATILITY", 0.00012),
		Spread:            envFloat("SPREAD", 0.0001),
		TrendChangeChance: envFloat("TREND_CHANGE_CHANCE", 0.05),
	}
}

// DSN формирует строку подключения к Postgres для pgx.
func (c Config) DSN() string {
	return fmt.Sprintf(
		"host=%s port=%s dbname=%s user=%s password=%s sslmode=disable",
		c.DBHost, c.DBPort, c.DBName, c.DBUser, c.DBPassword,
	)
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envDuration(key string, def time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return def
}

func envFloat(key string, def float64) float64 {
	if v := os.Getenv(key); v != "" {
		var f float64
		if _, err := fmt.Sscanf(v, "%g", &f); err == nil {
			return f
		}
	}
	return def
}
