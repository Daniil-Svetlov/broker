package market

import (
	"math"
	"math/rand"
	"testing"
)

// detRng — детерминированный источник для воспроизводимых тестов.
func detRng() *rand.Rand { return rand.New(rand.NewSource(1)) }

func TestCalculateNextPriceRounding(t *testing.T) {
	cfg := AssetConfig{Volatility: 0.001, MinPrice: 0, Precision: 2}
	got := CalculateNextPrice(detRng(), 100.0, TrendFlat, cfg)
	// Должно быть округлено до 2 знаков.
	if r := math.Round(got*100) / 100; r != got {
		t.Errorf("price %v не округлена до %d знаков", got, cfg.Precision)
	}
}

func TestCalculateNextPriceMinBarrier(t *testing.T) {
	cfg := AssetConfig{Volatility: 0.5, MinPrice: 10, Precision: 2}
	// При сильном падении цена не должна опуститься ниже барьера.
	for i := 0; i < 1000; i++ {
		got := CalculateNextPrice(detRng(), 1.0, TrendDown, cfg)
		if got < cfg.MinPrice {
			t.Fatalf("цена %v ниже барьера %v", got, cfg.MinPrice)
		}
	}
}

func TestTrendDriftBias(t *testing.T) {
	// На большом числе тиков восходящий тренд в среднем растит цену,
	// нисходящий — снижает (дрейф пересиливает нулевой средний шум).
	const ticks = 20000
	cfg := AssetConfig{Volatility: 0.01, MinPrice: 0, Precision: 8}

	up := 1.0
	rng := detRng()
	for i := 0; i < ticks; i++ {
		up = CalculateNextPrice(rng, up, TrendUp, cfg)
	}
	down := 1.0
	for i := 0; i < ticks; i++ {
		down = CalculateNextPrice(rng, down, TrendDown, cfg)
	}
	if up <= 1.0 {
		t.Errorf("восходящий тренд не поднял цену: %v", up)
	}
	if down >= 1.0 {
		t.Errorf("нисходящий тренд не опустил цену: %v", down)
	}
}

func TestRollTrendAnchorPull(t *testing.T) {
	rng := detRng()
	// Цена сильно выше якоря — при смене тренд должен тянуть вниз.
	if got := RollTrend(rng, TrendUp, 1.0, 110, 100); got != TrendDown {
		t.Errorf("ожидался разворот вниз к якорю, получили %s", got)
	}
	// Цена сильно ниже якоря — тренд должен тянуть вверх.
	if got := RollTrend(rng, TrendDown, 1.0, 90, 100); got != TrendUp {
		t.Errorf("ожидался разворот вверх к якорю, получили %s", got)
	}
	// chance=0 — тренд не меняется.
	if got := RollTrend(rng, TrendFlat, 0.0, 110, 100); got != TrendFlat {
		t.Errorf("при chance=0 тренд не должен меняться, получили %s", got)
	}
}
