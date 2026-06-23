// Package quotes — ядро сервиса котировок: получение реального базового
// курса онлайн, расчёт кросс-курсов (порт get_pair_rate из quotes.py) и
// поддержание «живой» цены с микро-тиками, чтобы бинарные опционы резолвились.
package quotes

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"math/rand"
	"net/http"
	"sync"
	"time"

	"github.com/Daniil-Svetlov/broker/quotes-service/internal/config"
	"github.com/Daniil-Svetlov/broker/quotes-service/internal/market"
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
	base    float64               // реальный базовый курс с провайдера
	mid     float64               // текущая «живая» mid-цена (база + накопленные тики)
	trend   market.TrendDirection // текущий тренд модели цены
	cfg     market.AssetConfig    // параметры генерации (волатильность, барьер, точность)
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
			st = &liveState{assetID: a.ID, mid: rate, trend: market.RandomTrend(s.rng)}
			s.state[a.Symbol] = st
		}
		st.assetID = a.ID
		st.base = rate
		if st.mid == 0 {
			st.mid = rate
		}
		// Параметры модели: барьер вполовину от реального курса (цена не уйдёт
		// в ноль), точность зависит от пары (JPY-кросс грубее форекса).
		st.cfg = market.AssetConfig{
			Volatility: s.cfg.TickVolatility,
			MinPrice:   rate * 0.5,
			Precision:  precisionFor(a.Symbol),
		}
	}
	return nil
}

// precisionFor подбирает число знаков под пару: котировки к JPY — 3 знака,
// остальной форекс — 5 (как в торговых терминалах).
func precisionFor(symbol string) int {
	if len(symbol) >= 3 && symbol[len(symbol)-3:] == "JPY" {
		return 3
	}
	return 5
}

// Tick двигает «живые» цены по модели market.CalculateNextPrice: дрейф по
// тренду + случайный шум. Тренд изредка меняется (RollTrend) с лёгким
// возвратом к реальному базовому курсу, чтобы цена не уходила далеко.
// Получаются настоящие онлайн-курсы, которые при этом меняются каждую секунду.
func (s *Service) Tick() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, st := range s.state {
		if st.base == 0 {
			continue
		}
		st.trend = market.RollTrend(s.rng, st.trend, s.cfg.TrendChangeChance, st.mid, st.base)
		st.mid = market.CalculateNextPrice(s.rng, st.mid, st.trend, st.cfg)
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
		Bid:       roundTo(st.mid-spread, st.cfg.Precision),
		Ask:       roundTo(st.mid+spread, st.cfg.Precision),
		Mid:       st.mid,
		Timestamp: time.Now().UTC(),
	}
}

// roundTo округляет цену до n знаков после запятой (как и mid в модели цены).
func roundTo(v float64, precision int) float64 {
	shift := math.Pow(10, float64(precision))
	return math.Round(v*shift) / shift
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
