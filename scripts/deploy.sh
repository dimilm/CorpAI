#!/usr/bin/env bash
# CorpAI production deploy.
#
# Pulls the requested ref, rebuilds the Docker stack on the server (the build
# happens here, matching the current `docker compose up --build` model), waits
# for the app to report healthy, then prunes dangling images. Idempotent and
# safe to re-run.
#
# Invoked by .github/workflows/deploy.yml over SSH, or by hand on the server:
#   DEPLOY_PATH=/opt/CorpAI bash scripts/deploy.sh
#
# Environment:
#   DEPLOY_PATH      repo checkout on the server (default: the repo this script
#                    lives in, resolved from its own path)
#   DEPLOY_REF       git ref to deploy: branch, tag or SHA (default: main)
#   HEALTH_URL       base URL the server-local nginx serves (default: http://localhost:8080)
#   HEALTH_RETRIES   health poll attempts        (default: 60)
#   HEALTH_DELAY     seconds between attempts     (default: 5)
set -euo pipefail

DEPLOY_REF="${DEPLOY_REF:-main}"
HEALTH_BASE="${HEALTH_URL:-http://localhost:8080}"
HEALTH_RETRIES="${HEALTH_RETRIES:-60}"
HEALTH_DELAY="${HEALTH_DELAY:-5}"

if [ -n "${DEPLOY_PATH:-}" ]; then
  REPO_DIR="$DEPLOY_PATH"
else
  REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi

log() { printf '==> %s\n' "$*"; }

cd "$REPO_DIR"
log "Deploying ref '$DEPLOY_REF' from $REPO_DIR"

log "Fetching from origin"
git fetch --prune --tags origin
git checkout --force "$DEPLOY_REF"
# Fast-forward to the remote tip only when the ref is a branch; tags and SHAs
# are checked out detached above and have no origin/<ref> to reset to.
if git show-ref --verify --quiet "refs/remotes/origin/$DEPLOY_REF"; then
  git reset --hard "origin/$DEPLOY_REF"
fi
log "Now at $(git rev-parse --short HEAD) -- $(git log -1 --pretty=%s)"

log "Rebuilding and starting containers"
cd docker
docker compose up -d --build

log "Waiting for health at $HEALTH_BASE (up to $((HEALTH_RETRIES * HEALTH_DELAY))s)"
healthy=0
for i in $(seq 1 "$HEALTH_RETRIES"); do
  # Frontend liveness (/healthz) and backend via the nginx proxy
  # (/api/v1/health) -- the backend port 8000 is not published.
  if curl -fsS "$HEALTH_BASE/healthz" >/dev/null 2>&1 \
    && curl -fsS "$HEALTH_BASE/api/v1/health" >/dev/null 2>&1; then
    healthy=1
    log "Healthy after ~$((i * HEALTH_DELAY))s"
    break
  fi
  sleep "$HEALTH_DELAY"
done

if [ "$healthy" -ne 1 ]; then
  log "ERROR: health checks did not pass in time"
  docker compose ps
  docker compose logs --tail=50 backend frontend || true
  exit 1
fi

log "Pruning unused images"
# -a (not just dangling): repeated `up --build` deploys leave the previous
# build's tagged images behind, which pile up fast on a small disk. Images
# backing a running container are still kept, so the live stack is safe.
docker image prune -af >/dev/null

docker compose ps
log "Deploy complete."
