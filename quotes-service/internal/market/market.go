// Package market — генератор цен: моделирует движение котировки случайным
// блужданием с дрейфом по направлению тренда. Используется и в сервисе
// (живые тики поверх реального курса), и в standalone-генераторе cmd/pricegen.
package market

import (
	"math"
	"math/rand"
)

// TrendDirection — направление текущего тренда цены.
type TrendDirection string

const (
	TrendUp   TrendDirection = "UP"
	TrendDown TrendDirection = "DOWN"
	TrendFlat TrendDirection = "FLAT"
)

// AssetConfig — параметры генерации цены конкретного актива.
type AssetConfig struct {
	Volatility float64 // масштаб случайных колебаний (доля от цены за тик)
	MinPrice   float64 // защитный барьер: цена не опускается ниже
	Precision  int     // округление (2 для крипты, 5 для форекса типа EUR/USD)
}

// CalculateNextPrice вычисляет следующую цену на основе текущей, тренда и
// конфигурации актива. rng передаётся явно — так функция остаётся чистой,
// потокобезопасной (каждый вызывающий владеет своим источником) и тестируемой.
func CalculateNextPrice(rng *rand.Rand, currentPrice float64, trend TrendDirection, cfg AssetConfig) float64 {
	var drift float64
	switch trend {
	case TrendUp:
		drift = cfg.Volatility * 0.25
	case TrendDown:
		drift = -cfg.Volatility * 0.25
	default:
		drift = 0.0
	}

	noise := rng.Float64() - 0.5
	changePercent := drift + (cfg.Volatility * noise)
	nextPrice := currentPrice * (1.0 + changePercent)

	if nextPrice < cfg.MinPrice {
		nextPrice = cfg.MinPrice
	}

	shift := math.Pow(10, float64(cfg.Precision))
	return math.Round(nextPrice*shift) / shift
}

// RandomTrend выбирает случайное направление тренда. Тренд держится не каждый
// тик, а пока RollTrend не решит его сменить, — так получаются связные движения,
// а не белый шум.
func RandomTrend(rng *rand.Rand) TrendDirection {
	switch rng.Intn(3) {
	case 0:
		return TrendUp
	case 1:
		return TrendDown
	default:
		return TrendFlat
	}
}

// RollTrend с вероятностью chance меняет тренд на новый случайный, иначе
// оставляет текущий. anchor (например, реальный базовый курс) задаёт лёгкий
// возврат: если цена ушла далеко от якоря, новый тренд тянет обратно.
func RollTrend(rng *rand.Rand, current TrendDirection, chance, price, anchor float64) TrendDirection {
	if rng.Float64() >= chance {
		return current
	}
	if anchor > 0 {
		switch {
		case price > anchor*1.005:
			return TrendDown
		case price < anchor*0.995:
			return TrendUp
		}
	}
	return RandomTrend(rng)
}
