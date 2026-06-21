package quotes

import (
	"math"
	"testing"
)

func TestPairRate(t *testing.T) {
	// Курсы относительно USD (сколько единиц валюты за 1 USD).
	rates := map[string]float64{
		"USD": 1,
		"EUR": 0.92,   // 0.92 EUR за 1 USD
		"JPY": 156.0,  // 156 JPY за 1 USD
		"GBP": 0.79,   // 0.79 GBP за 1 USD
	}

	cases := []struct {
		symbol string
		want   float64
	}{
		{"USD/JPY", 156.0},        // прямой
		{"EUR/USD", 1 / 0.92},     // обратный
		{"EUR/GBP", 0.92 / 0.79},  // кросс
	}

	for _, c := range cases {
		got, ok := pairRate(rates, c.symbol)
		if !ok {
			t.Fatalf("%s: pairRate returned not ok", c.symbol)
		}
		if math.Abs(got-c.want) > 1e-9 {
			t.Errorf("%s: got %v, want %v", c.symbol, got, c.want)
		}
	}
}

func TestPairRateMissing(t *testing.T) {
	rates := map[string]float64{"USD": 1, "EUR": 0.92}
	if _, ok := pairRate(rates, "EUR/XXX"); ok {
		t.Error("expected not ok for unknown currency")
	}
}
