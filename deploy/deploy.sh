#!/usr/bin/env bash
# Ручной деплой тега из GHCR (обычно деплоит GitHub Actions автоматически).
#
#   deploy/deploy.sh <image_tag>       напр.  deploy/deploy.sh main
#                                      или    deploy/deploy.sh sha-<git-sha>
#
# Переопределяется через окружение:
#   ORION_SSH_HOST (admin@195.19.202.35)  ORION_SSH_PORT (25346)
#   ORION_SSH_KEY  (~/.ssh/id_ed25519_new) ORION_REMOTE_DIR (/opt/oriontrade)
#
# Образы должны быть уже собраны CI и лежать в GHCR. Сервер должен быть
# залогинен в ghcr.io (docker login) либо образы публичные.
set -euo pipefail

TAG="${1:?usage: deploy.sh <image_tag>  (напр. main)}"
SSH_HOST="${ORION_SSH_HOST:-admin@195.19.202.35}"
SSH_PORT="${ORION_SSH_PORT:-25346}"
SSH_KEY="${ORION_SSH_KEY:-$HOME/.ssh/id_ed25519_new}"
REMOTE_DIR="${ORION_REMOTE_DIR:-/opt/oriontrade}"

SSH_CMD="ssh -i $SSH_KEY -p $SSH_PORT -o StrictHostKeyChecking=accept-new"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo ">> копирую compose + apply.sh на $SSH_HOST"
scp -i "$SSH_KEY" -P "$SSH_PORT" -o StrictHostKeyChecking=accept-new \
  "$REPO_ROOT/deploy/docker-compose.prod.yml" \
  "$REPO_ROOT/deploy/apply.sh" \
  "$SSH_HOST:$REMOTE_DIR/deploy/"

echo ">> apply $TAG"
$SSH_CMD "$SSH_HOST" "chmod +x $REMOTE_DIR/deploy/apply.sh && $REMOTE_DIR/deploy/apply.sh '$TAG'"
