// Команда quotes — микросервис котировок (go-порт quotes.py).
//
// Режимы:
//
//	quotes            — демон: онлайн-курсы + живые тики + HTTP API + запись в БД.
//	quotes -init      — создать валютные пары в БД и выйти (порт init_assets.py).
//	quotes -once      — один прогон записи котировок в БД и выход (для cron).
package main

import (
	"context"
	"flag"
	"log"
	"net/http"
	"os/signal"
	"syscall"
	"time"

	"github.com/Daniil-Svetlov/broker/quotes-service/internal/config"
	"github.com/Daniil-Svetlov/broker/quotes-service/internal/httpapi"
	"github.com/Daniil-Svetlov/broker/quotes-service/internal/quotes"
	"github.com/Daniil-Svetlov/broker/quotes-service/internal/store"
)

func main() {
	initOnly := flag.Bool("init", false, "создать валютные пары в БД и выйти")
	once := flag.Bool("once", false, "один прогон записи котировок и выход")
	flag.Parse()

	cfg := config.Load()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	log.Printf("connecting to postgres %s:%s/%s ...", cfg.DBHost, cfg.DBPort, cfg.DBName)
	st, err := store.New(ctx, cfg.DSN())
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	defer st.Close()
	log.Println("postgres connected")

	if *initOnly {
		if err := st.InitAssets(ctx, quotes.CurrencyPairs); err != nil {
			log.Fatalf("init assets: %v", err)
		}
		log.Println("Assets initialized successfully")
		return
	}

	// Гарантируем наличие пар и берём активные.
	if err := st.InitAssets(ctx, quotes.CurrencyPairs); err != nil {
		log.Fatalf("init assets: %v", err)
	}
	assets, err := st.ActiveAssets(ctx)
	if err != nil {
		log.Fatalf("active assets: %v", err)
	}

	log.Printf("assets seeded, %d active; fetching base rates from %s ...", len(assets), cfg.RatesAPIURL)
	svc := quotes.New(cfg, st)
	if err := svc.RefreshBase(ctx, assets); err != nil {
		log.Fatalf("fetch base rates: %v", err)
	}
	log.Println("base rates fetched")

	if *once {
		if err := svc.Persist(ctx); err != nil {
			log.Fatalf("persist quotes: %v", err)
		}
		log.Println("Quotes updated successfully")
		return
	}

	runDaemon(ctx, cfg, st, svc, assets)
}

func runDaemon(ctx context.Context, cfg config.Config, st *store.Store, svc *quotes.Service, assets []store.Asset) {
	// HTTP API.
	srv := &http.Server{Addr: cfg.HTTPAddr, Handler: httpapi.New(svc).Handler()}
	go func() {
		log.Printf("quotes API listening on %s", cfg.HTTPAddr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("http: %v", err)
		}
	}()

	tick := time.NewTicker(cfg.TickInterval)
	persist := time.NewTicker(cfg.PersistInterval)
	refresh := time.NewTicker(cfg.BaseRefreshInterval)
	defer tick.Stop()
	defer persist.Stop()
	defer refresh.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Println("shutting down...")
			shutCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			_ = srv.Shutdown(shutCtx)
			cancel()
			return

		case <-tick.C:
			svc.Tick()

		case <-persist.C:
			if err := svc.Persist(ctx); err != nil {
				log.Printf("persist: %v", err)
			}

		case <-refresh.C:
			fresh, err := st.ActiveAssets(ctx)
			if err != nil {
				log.Printf("refresh assets: %v", err)
				continue
			}
			assets = fresh
			if err := svc.RefreshBase(ctx, assets); err != nil {
				log.Printf("refresh base rates: %v", err)
			}
		}
	}
}
