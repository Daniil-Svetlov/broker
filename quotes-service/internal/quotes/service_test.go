package quotes

import (
	"math"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Daniil-Svetlov/broker/quotes-service/internal/config"
	"github.com/Daniil-Svetlov/broker/quotes-service/internal/store"
)

func TestPairRate(t *testing.T) {
	// Курсы относительно USD (сколько единиц валюты за 1 USD).
	rates := map[string]float64{
		"USD": 1,
		"EUR": 0.92,  // 0.92 EUR за 1 USD
		"JPY": 156.0, // 156 JPY за 1 USD
		"GBP": 0.79,  // 0.79 GBP за 1 USD
	}

	cases := []struct {
		symbol string
		want   float64
	}{
		{"USD/JPY", 156.0},       // прямой
		{"EUR/USD", 1 / 0.92},    // обратный
		{"EUR/GBP", 0.92 / 0.79}, // кросс
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

func TestPrecisionFor(t *testing.T) {
	cases := map[string]int{
		"EUR/USD": 5,
		"GBP/USD": 5,
		"USD/JPY": 3,
		"EUR/JPY": 3,
	}
	for sym, want := range cases {
		if got := precisionFor(sym); got != want {
			t.Errorf("precisionFor(%q) = %d, want %d", sym, got, want)
		}
	}
}

// newSvcWithRates поднимает Service с мок-провайдером курсов и наполняет
// состояние через RefreshBase — без БД и реального порта.
func newSvcWithRates(t *testing.T) *Service {
	t.Helper()
	rates := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"result":"success","rates":{"USD":1,"EUR":0.92,"JPY":156.0}}`))
	}))
	t.Cleanup(rates.Close)

	cfg := config.Load()
	cfg.RatesAPIURL = rates.URL

	svc := New(cfg, nil)
	assets := []store.Asset{
		{ID: "a1", Symbol: "EUR/USD"},
		{ID: "a2", Symbol: "USD/JPY"},
	}
	if err := svc.RefreshBase(t.Context(), assets); err != nil {
		t.Fatalf("RefreshBase: %v", err)
	}
	return svc
}

func TestTickMovesPrice(t *testing.T) {
	svc := newSvcWithRates(t)
	start, _ := svc.Get("EUR/USD")

	moved := false
	for i := 0; i < 200; i++ {
		svc.Tick()
		if cur, _ := svc.Get("EUR/USD"); cur.Mid != start.Mid {
			moved = true
			break
		}
	}
	if !moved {
		t.Error("Tick не сдвинул цену за 200 тиков")
	}
}

func TestTickStaysNearBaseAndRounds(t *testing.T) {
	svc := newSvcWithRates(t)
	for i := 0; i < 5000; i++ {
		svc.Tick()
	}

	// USD/JPY ≈ 156, округление до 3 знаков, цена держится у базы (барьер/возврат).
	p, ok := svc.Get("USD/JPY")
	if !ok {
		t.Fatal("нет котировки USD/JPY")
	}
	if r := math.Round(p.Mid*1000) / 1000; r != p.Mid {
		t.Errorf("USD/JPY mid %v не округлён до 3 знаков", p.Mid)
	}
	// За 5000 тиков случайное блуждание не должно увести цену слишком далеко.
	if p.Mid < 156*0.9 || p.Mid > 156*1.1 {
		t.Errorf("USD/JPY mid %v ушёл далеко от базы 156", p.Mid)
	}
	if !(p.Bid < p.Mid && p.Mid < p.Ask) {
		t.Errorf("ожидался bid<mid<ask, получили %+v", p)
	}
}
