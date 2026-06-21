package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Daniil-Svetlov/broker/quotes-service/internal/config"
	"github.com/Daniil-Svetlov/broker/quotes-service/internal/quotes"
	"github.com/Daniil-Svetlov/broker/quotes-service/internal/store"
)

// Проверяем HTTP-слой целиком, не открывая реальный порт: мок-провайдер
// курсов + httptest. Покрывает fetch → расчёт курса → живая цена → JSON.
func TestPriceEndpoint(t *testing.T) {
	// Мок ответа open.er-api.com.
	rates := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"result":"success","rates":{"USD":1,"EUR":0.92,"JPY":156.0}}`))
	}))
	defer rates.Close()

	cfg := config.Load()
	cfg.RatesAPIURL = rates.URL
	cfg.Spread = 0.0001

	svc := quotes.New(cfg, nil) // store не нужен: RefreshBase принимает assets напрямую
	assets := []store.Asset{
		{ID: "a1", Symbol: "EUR/USD"},
		{ID: "a2", Symbol: "USD/JPY"},
	}
	if err := svc.RefreshBase(t.Context(), assets); err != nil {
		t.Fatalf("RefreshBase: %v", err)
	}

	h := New(svc).Handler()

	// GET /price?symbol=EUR/USD
	req := httptest.NewRequest(http.MethodGet, "/price?symbol=EUR/USD", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
	var p quotes.Price
	if err := json.Unmarshal(rec.Body.Bytes(), &p); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if p.Symbol != "EUR/USD" {
		t.Errorf("symbol = %q", p.Symbol)
	}
	// EUR/USD ≈ 1/0.92 ≈ 1.087, bid < mid < ask.
	if !(p.Bid < p.Mid && p.Mid < p.Ask) {
		t.Errorf("ожидался bid<mid<ask, получили %+v", p)
	}
	if p.Mid < 1.0 || p.Mid > 1.2 {
		t.Errorf("EUR/USD mid вне ожидаемого диапазона: %v", p.Mid)
	}

	// Неизвестная пара -> 404.
	req = httptest.NewRequest(http.MethodGet, "/price?symbol=XXX/YYY", nil)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("ожидался 404 для неизвестной пары, получили %d", rec.Code)
	}
}
