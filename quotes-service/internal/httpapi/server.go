// Package httpapi отдаёт живые котировки наружу. Django берёт цену для
// открытия и закрытия сделки именно отсюда — «онлайн», а не из снапшота в БД.
package httpapi

import (
	"encoding/json"
	"net/http"

	"github.com/Daniil-Svetlov/broker/quotes-service/internal/quotes"
)

type Server struct {
	svc *quotes.Service
}

func New(svc *quotes.Service) *Server { return &Server{svc: svc} }

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", s.health)
	mux.HandleFunc("/price", s.price)
	mux.HandleFunc("/prices", s.prices)
	return withCORS(mux)
}

// withCORS разрешает фронтенду (HTML/JS на другом порту) ходить за котировками
// через fetch. Без этих заголовков браузер режет ответ по Same-Origin Policy
// («Origin ... is not allowed by Access-Control-Allow-Origin»), и страница
// падает. Политика — открытая, как CORS_ALLOW_ALL_ORIGINS=True у Django: это
// публичные read-only котировки без кук и авторизации.
func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Vary", "Origin")
		// Префлайт (OPTIONS) завершаем сразу, до бизнес-логики.
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// GET /price?symbol=EUR/USD — живая котировка одной пары.
func (s *Server) price(w http.ResponseWriter, r *http.Request) {
	symbol := r.URL.Query().Get("symbol")
	if symbol == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "symbol is required"})
		return
	}
	p, ok := s.svc.Get(symbol)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no quote for symbol " + symbol})
		return
	}
	writeJSON(w, http.StatusOK, p)
}

// GET /prices — все живые котировки.
func (s *Server) prices(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.svc.All())
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
