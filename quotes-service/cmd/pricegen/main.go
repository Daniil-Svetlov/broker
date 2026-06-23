// Команда pricegen — standalone-генератор цен: непрерывно печатает котировки
// в консоль по алгоритму из internal/market. Реальный курс и БД не нужны —
// удобно глазами посмотреть, как ведёт себя модель.
//
//	go run ./cmd/pricegen                      # пары по умолчанию, тик 1с
//	go run ./cmd/pricegen -symbol BTC/USD -price 65000 -precision 2 -vol 0.002
//	go run ./cmd/pricegen -interval 200ms -ticks 50
package main

import (
	"flag"
	"fmt"
	"math/rand"
	"strings"
	"time"

	"github.com/Daniil-Svetlov/broker/quotes-service/internal/market"
)

func main() {
	symbol := flag.String("symbol", "", "одна пара (напр. BTC/USD); по умолчанию набор форекс-пар")
	start := flag.Float64("price", 0, "стартовая цена для -symbol (0 = подобрать автоматически)")
	precision := flag.Int("precision", 5, "знаков после запятой для -symbol")
	vol := flag.Float64("vol", 0.0008, "волатильность (доля от цены за тик)")
	interval := flag.Duration("interval", time.Second, "период между тиками")
	ticks := flag.Int("ticks", 0, "сколько тиков сгенерировать (0 = бесконечно)")
	chance := flag.Float64("trend-change", 0.08, "вероятность смены тренда за тик")
	flag.Parse()

	rng := rand.New(rand.NewSource(time.Now().UnixNano()))

	type gen struct {
		symbol string
		price  float64
		trend  market.TrendDirection
		cfg    market.AssetConfig
	}

	var gens []*gen
	if *symbol != "" {
		price := *start
		if price == 0 {
			price = 1.0
		}
		gens = append(gens, &gen{
			symbol: strings.ToUpper(*symbol),
			price:  price,
			trend:  market.RandomTrend(rng),
			cfg:    market.AssetConfig{Volatility: *vol, MinPrice: price * 0.2, Precision: *precision},
		})
	} else {
		// Набор форекс-пар с правдоподобными стартовыми ценами.
		seed := []struct {
			symbol string
			price  float64
			prec   int
		}{
			{"EUR/USD", 1.08, 5},
			{"GBP/USD", 1.27, 5},
			{"USD/JPY", 156.0, 3},
			{"USD/CHF", 0.90, 5},
			{"AUD/USD", 0.66, 5},
		}
		for _, s := range seed {
			gens = append(gens, &gen{
				symbol: s.symbol,
				price:  s.price,
				trend:  market.RandomTrend(rng),
				cfg:    market.AssetConfig{Volatility: *vol, MinPrice: s.price * 0.2, Precision: s.prec},
			})
		}
	}

	fmt.Printf("price generator: %d asset(s), interval %s, volatility %.4g (Ctrl+C для выхода)\n",
		len(gens), *interval, *vol)

	ticker := time.NewTicker(*interval)
	defer ticker.Stop()

	for n := 0; *ticks == 0 || n < *ticks; n++ {
		ts := (<-ticker.C).UTC().Format("15:04:05")
		for _, g := range gens {
			prev := g.price
			g.trend = market.RollTrend(rng, g.trend, *chance, g.price, 0)
			g.price = market.CalculateNextPrice(rng, g.price, g.trend, g.cfg)
			fmt.Printf("%s  %-8s %*.*f  %-4s %+.4f%%\n",
				ts, g.symbol, g.cfg.Precision+4, g.cfg.Precision, g.price,
				g.trend, (g.price-prev)/prev*100)
		}
	}
}
