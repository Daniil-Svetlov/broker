// Package quotes — ядро сервиса котировок: получение реального базового
// курса онлайн, расчёт кросс-курсов (порт get_pair_rate из quotes.py) и
// поддержание «живой» цены с микро-тиками, чтобы бинарные опционы резолвились.
package quotes

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"sync"
	"time"

	"github.com/Daniil-Svetlov/broker/quotes-service/internal/config"
	"github.com/Daniil-Svetlov/broker/quotes-service/internal/store"
)

// CurrencyPairs — пары по умолчанию, повторяют CURRENCY_PAIRS из quotes.py.
var CurrencyPairs = [][2]string{
	{"EUR/USD", "Euro / US Dollar"},
	{"USD/CAD", "US Dollar / Canadian Dollar"},
	{"GBP/USD", "British Pound / US Dollar"},
	{"USD/JPY", "US Dollar / Japanese Yen"},
	{"AUD/USD", "Australian Dollar / US Dollar"},
	{"USD/CHF", "US Dollar / Swiss Franc"},
	{"NZD/USD", "New Zealand Dollar / US Dollar"},
	{"EUR/GBP", "Euro / British Pound"},
}

// Price — живая котировка пары.
type Price struct {
	Symbol    string    `json:"symbol"`
	Bid       float64   `json:"bid"`
	Ask       float64   `json:"ask"`
	Mid       float64   `json:"mid"`
	Timestamp time.Time `json:"timestamp"`
}

// liveState — текущее состояние одной пары в памяти.
type liveState struct {
	assetID string
	base    float64 // реальный базовый курс с провайдера
	mid     float64 // текущая «живая» mid-цена (база + накопленные тики)
}

type Service struct {
	cfg   config.Config
	store *store.Store
	http  *http.Client

	mu    sync.RWMutex
	state map[string]*liveState // symbol -> состояние
	rng   *rand.Rand
}

func New(cfg config.Config, st *store.Store) *Service {
	return &Service{
		cfg:   cfg,
		store: st,
		http:  &http.Client{Timeout: 10 * time.Second},
		state: make(map[string]*liveState),
		rng:   rand.New(rand.NewSource(time.Now().UnixNano())),
	}
}

// apiResponse — формат ответа open.er-api.com.
type apiResponse struct {
	Result string             `json:"result"`
	Rates  map[string]float64 `json:"rates"`
}

// fetchBaseRates получает курсы относительно USD (порт fetch_quotes_from_api).
func (s *Service) fetchBaseRates(ctx context.Context) (map[string]float64, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.cfg.RatesAPIURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := s.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("rates api request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("rates api status %d", resp.StatusCode)
	}
	var data apiResponse
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, fmt.Errorf("decode rates: %w", err)
	}
	if len(data.Rates) == 0 {
		return nil, fmt.Errorf("rates api returned empty rates")
	}
	return data.Rates, nil
}

// pairRate считает курс пары из курсов к USD (порт get_pair_rate):
// прямой (USD/X), обратный (X/USD) и кросс-курс (X/Y).
func pairRate(rates map[string]float64, symbol string) (float64, bool) {
	var base, quote string
	if _, err := fmt.Sscanf(symbol, "%3s/%3s", &base, &quote); err != nil {
		return 0, false
	}
	baseRate, okB := rates[base]
	quoteRate, okQ := rates[quote]
	if !okB || !okQ || baseRate == 0 || quoteRate == 0 {
		return 0, false
	}
	switch {
	case base == "USD":
		return quoteRate, true
	case quote == "USD":
		return 1 / baseRate, true
	default:
		return baseRate / quoteRate, true
	}
}

// RefreshBase перечитывает реальные курсы и обновляет базу для каждой пары.
// «Живая» mid-цена при первом запуске инициализируется базой, далее тики
// продолжают двигаться вокруг свежей базы.
func (s *Service) RefreshBase(ctx context.Context, assets []store.Asset) error {
	rates, err := s.fetchBaseRates(ctx)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, a := range assets {
		rate, ok := pairRate(rates, a.Symbol)
		if !ok {
			log.Printf("skip %s: rate not found in API", a.Symbol)
			continue
		}
		st, exists := s.state[a.Symbol]
		if !exists {
			st = &liveState{assetID: a.ID, mid: rate}
			s.state[a.Symbol] = st
		}
		st.assetID = a.ID
		st.base = rate
		if st.mid == 0 {
			st.mid = rate
		}
	}
	return nil
}

// Tick двигает «живые» цены случайным блужданием вокруг базового курса.
// Это даёт настоящие онлайн-курсы, которые при этом меняются каждую секунду.
func (s *Service) Tick() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, st := range s.state {
		if st.base == 0 {
			continue
		}
		step := (s.rng.Float64() - 0.5) * 2 * s.cfg.TickVolatility * st.base
		st.mid += step
		// Лёгкий возврат к базе, чтобы цена не уходила далеко от реальной.
		st.mid += (st.base - st.mid) * 0.01
		if st.mid <= 0 {
			st.mid = st.base
		}
	}
}

// Get возвращает текущую живую котировку пары (bid/ask со спредом).
func (s *Service) Get(symbol string) (Price, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	st, ok := s.state[symbol]
	if !ok || st.mid == 0 {
		return Price{}, false
	}
	return s.priceFrom(symbol, st), true
}

// All возвращает все текущие живые котировки.
func (s *Service) All() []Price {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Price, 0, len(s.state))
	for symbol, st := range s.state {
		if st.mid == 0 {
			continue
		}
		out = append(out, s.priceFrom(symbol, st))
	}
	return out
}

func (s *Service) priceFrom(symbol string, st *liveState) Price {
	spread := st.mid * s.cfg.Spread
	return Price{
		Symbol:    symbol,
		Bid:       st.mid - spread,
		Ask:       st.mid + spread,
		Mid:       st.mid,
		Timestamp: time.Now().UTC(),
	}
}

// Persist пишет текущие живые котировки в Postgres (история для графиков).
func (s *Service) Persist(ctx context.Context) error {
	s.mu.RLock()
	type row struct {
		assetID  string
		bid, ask float64
	}
	rows := make([]row, 0, len(s.state))
	for _, st := range s.state {
		if st.mid == 0 || st.assetID == "" {
			continue
		}
		spread := st.mid * s.cfg.Spread
		rows = append(rows, row{st.assetID, st.mid - spread, st.mid + spread})
	}
	s.mu.RUnlock()

	for _, r := range rows {
		if err := s.store.InsertQuote(ctx, r.assetID, r.bid, r.ask); err != nil {
			return err
		}
	}
	return nil
}
