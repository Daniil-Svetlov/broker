# --- build ---
# alpine-вариант намного меньше полного golang-образа (быстрее качать/собирать);
# сборка статическая (CGO_ENABLED=0), внешних C-зависимостей нет.
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /out/quotes ./cmd/quotes

# --- run ---
FROM gcr.io/distroless/static-debian12
COPY --from=build /out/quotes /quotes
EXPOSE 8090
ENTRYPOINT ["/quotes"]
