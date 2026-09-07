# Деплой OrionTrade

Один сервер, Docker Compose. Образы собираются в GitHub Actions, публикуются в
**GHCR**, сервер их только тянет — на сервере ничего не собирается. Всё на домене
`oriontrade.tech`: статика фронта + `/api/` → Django + `/quotes/` → Go.

```
 push в main
     │
     ▼
 GitHub Actions ── backend + quotes checks ─┐
                                            ▼
                         сборка 3 образов → GHCR (ghcr.io/…/broker-{api,quotes,web})
                                            │
                                            ▼
                    ssh → сервер: apply.sh sha-<commit>
                                            │  pull + up -d + health-gate (+ авто-откат)
                                            ▼
        ┌──────────────── сервер 195.19.202.35 ────────────────┐
 CF ───▶│ cloudflared ─▶ nginx(broker-web) ─┬─ /       → статика (запечена в образ) │
 tunnel │                                   ├─ /api /admin /static → api (gunicorn)  │
        │                                   └─ /quotes → quotes (Go)                 │
        │        api, quotes, settler ──▶ db (Postgres, том pgdata, наружу закрыт)   │
        └─────────────────────────────────────────────────────────────────────────────┘
```

`settler` — фоновый процесс закрытия истёкших сделок. WebSocket нет: график
опрашивает `/quotes/price` раз в секунду. Трафик от Cloudflare идёт через
**Cloudflare Tunnel** (см. §4) — прямой вход CF→сервер через NAT хостера
подвисает.

---

## 1. Разовая подготовка сервера (нужен root)

`ssh -i ~/.ssh/id_ed25519_new -p 25346 admin@195.19.202.35`

```bash
# swap — на 960 МБ RAM подушка под пики (сборки на сервере нет, но не лишнее)
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swap.conf && sudo sysctl -w vm.swappiness=10

# Docker + плагин compose
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker admin        # переоткрыть SSH-сессию после этого

# firewall — SSH-порт 25346 разрешить ДО enable!
sudo ufw allow 25346/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
sudo ufw --force enable

# каталог
sudo mkdir -p /opt/oriontrade/deploy && sudo chown -R admin:admin /opt/oriontrade
```

---

## 2. Секреты на сервере (`deploy/.env`)

Файл переживает деплои, в `.gitignore`, CI его не трогает.

```bash
cd /opt/oriontrade/deploy
curl -fsSLO https://raw.githubusercontent.com/Daniil-Svetlov/broker/main/deploy/.env.example  # или скопировать руками
cp .env.example .env
sed -i "s|^DB_PASSWORD=.*|DB_PASSWORD=$(openssl rand -hex 24)|" .env
sed -i "s|^DJANGO_SECRET_KEY=.*|DJANGO_SECRET_KEY=$(openssl rand -base64 48 | tr -d '\n/')|" .env
# CLOUDFLARE_TUNNEL_TOKEN — из §4, IMAGE_TAG apply.sh ведёт сам
```

---

## 3. CI/CD — `.github/workflows/ci-cd.yml`

| Триггер | Что делает |
|---|---|
| **PR в `main`** | `backend` (ruff-ошибки, `manage.py check`, `makemigrations --check`, `manage.py test` на Postgres) + `quotes` (`gofmt`, `go vet`, `go build`, `go test -race`). Образы собираются, но **не** пушатся. |
| **push в `main`** | те же проверки → сборка `broker-{api,quotes,web}` → GHCR (теги `sha-<commit>` и `main`) → `deploy` → `smoke`. |
| **Run workflow** | вручную с любой ветки/коммита. |

`deploy` job: `scp` compose+`apply.sh` на сервер → `ssh` → `docker login ghcr.io`
(эфемерный `GITHUB_TOKEN`) → `apply.sh sha-<commit>`.

`apply.sh` (на сервере): пишет `IMAGE_TAG` в `.env` → `compose pull` → `up -d` →
**health-gate** (30×3с: `/api/assets/` и `/quotes/price` через nginx). Не прошёл —
**авто-откат** на предыдущий `IMAGE_TAG` и job падает. `smoke` job после этого
дёргает публичные URL через Cloudflare.

### Разовая настройка

1. **Deploy-ключ.** ed25519 без пароля; публичная часть — в
   `~admin/.ssh/authorized_keys` на сервере.
2. **Секреты репозитория** — Settings → Secrets and variables → Actions
   (нужна роль Admin):
   - секрет `DEPLOY_SSH_KEY` — приватная часть ключа целиком (с `-----BEGIN…`).
   - секрет `DEPLOY_HOST` — `195.19.202.35`.
   - переменная (**Variables**, не секрет) `DEPLOY_ENABLED` = `true` —
     включает job `deploy`. Пока её нет, push в `main` гоняет только
     проверки и сборку.
   (порт `25346` и юзер `admin` зашиты в workflow.)
3. **GHCR.** Образы пушит `GITHUB_TOKEN` (права `packages: write` в job).
   Сервер тянет тем же токеном во время деплоя. Если pull не проходит — сделать
   пакеты `broker-*` публичными (репо → Packages → Package settings) либо
   завести PAT c `read:packages` и `docker login ghcr.io` на сервере разово.
4. **(опц.) Environment `production`** с required reviewers — тогда каждый
   деплой ждёт ручного подтверждения в Actions.

### Ручной деплой / откат

```bash
deploy/deploy.sh main               # с локальной машины: залить тег main
deploy/deploy.sh sha-<commit>       # конкретную сборку

# на сервере — откат на предыдущую сборку:
cd /opt/oriontrade/deploy
./apply.sh sha-<предыдущий-commit>   # apply.sh сам хранит prev в .env при каждом деплое
```

Бэкенд-изменения льём в `main` (при желании дублируем в ветку `Backend`) —
деплой смотрит только на `main`.

### Локальная сборка (без GHCR)

```bash
cd deploy && cp .env.example .env    # заполнить DB_PASSWORD / DJANGO_SECRET_KEY
IMAGE_TAG=local docker compose -f docker-compose.prod.yml -f docker-compose.build.yml up -d --build
```

---

## 4. Cloudflare Tunnel

Прямой путь CF→сервер (`:80` через NAT хостера) даёт зависания на 30+ сек на
части запросов — сервер здоров, тормозит канал. Поэтому трафик идёт через
**Cloudflare Tunnel**: контейнер `cloudflared` держит исходящее соединение к CF.

Дашборд **Zero Trust** (one.dash.cloudflare.com):

1. **Networks → Tunnels → Create a tunnel → Cloudflared**, имя `oriontrade`.
2. Экран **Install connector → Docker**: скопировать токен (строка после
   `--token`, на `eyJ…`). В `deploy/.env` на сервере: `CLOUDFLARE_TUNNEL_TOKEN=eyJ…`
3. **Public Hostnames** → добавить два:
   - `oriontrade.tech`      → Type **HTTP**, URL `nginx:80`
   - `www.oriontrade.tech`  → Type **HTTP**, URL `nginx:80`

   CF сам заменит `A`-записи на `CNAME` в туннель.
4. Задеплоить (любой push в `main` или `deploy/deploy.sh main`). `apply.sh` видит
   токен в `.env` и поднимает `cloudflared` (профиль `tunnel`).
5. Проверка: `docker compose -f docker-compose.prod.yml --profile tunnel logs cloudflared`
   → `Registered tunnel connection`.

SSL/TLS mode при туннеле не критичен; оставить **Flexible** или переключить на
**Full**. Django доверяет `X-Forwarded-Proto` от `cloudflared`
(`DJANGO_SECURE_SSL_PROXY=true`). Включить «Always Use HTTPS».

После проверки туннеля — убрать `ports: ["80:80"]` у `nginx` и `sudo ufw deny 80/tcp`.

---

## 5. Проверка

```bash
cd /opt/oriontrade/deploy
docker compose -f docker-compose.prod.yml ps                 # все healthy/running
curl -s localhost/api/assets/ | head -c 200
curl -s 'localhost/quotes/price?symbol=EUR/USD'
curl -sI localhost/ | head -1
# снаружи:
curl -s https://oriontrade.tech/api/assets/ | head -c 200
```

Django admin — суперюзер:
```bash
docker compose -f docker-compose.prod.yml exec api python manage.py createsuperuser
```
затем `https://oriontrade.tech/admin/`.

---

## 6. Эксплуатация

```bash
cd /opt/oriontrade/deploy
C="docker compose -f docker-compose.prod.yml"

$C logs -f --tail 100 api        # api|quotes|settler|nginx|db  (cloudflared — с --profile tunnel)
$C ps
$C restart api

./apply.sh sha-<commit>          # выкатить/откатить конкретный тег вручную

# бэкап / restore БД
$C exec -T db pg_dump -U orion binary | gzip > ~/orion-$(date +%F).sql.gz
gunzip -c ~/orion-YYYY-MM-DD.sql.gz | $C exec -T db psql -U orion binary

docker system prune -f           # чистка (сервер ~5 ГБ)
```

---

## Файлы

| файл | назначение |
|------|-----------|
| `docker-compose.prod.yml` | прод-стек, образы из GHCR по `${IMAGE_TAG}` |
| `docker-compose.build.yml` | оверлей для локальной сборки образов |
| `web.Dockerfile` | образ `broker-web` = nginx + запечённая статика фронта |
| `nginx.conf` | роутинг статики + прокси на api/quotes, кеш-заголовки |
| `config.prod.js` | конфиг фронта (кладётся вместо `config.js` в образ) |
| `apply.sh` | **на сервере**: pull + up + health-gate + откат |
| `deploy.sh` | ручной запуск `apply.sh` через ssh с локальной машины |
| `.env.example` | шаблон `deploy/.env` (секреты, не в git) |
