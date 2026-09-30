#!/usr/bin/env bash
# Detached post-restart watcher for self-update (see scripts/self-update.sh).
# Restarts the bot, polls /health, rolls back on failure, and notifies the owner.
set -uo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

PREV="${1:?prev commit required}"
NEW="${2:?new commit required}"
DELAY="${3:-20}"
TIMEOUT="${4:-60}"

LOG="$REPO_DIR/data/self-update.log"
STATUS_FILE="$REPO_DIR/data/self-update.status"
HEALTH_URL="http://127.0.0.1:4500/health"

if docker compose version >/dev/null 2>&1; then DC="docker compose"; else DC="docker-compose"; fi

log() { printf '%s | %s\n' "$(date -Is)" "$*" >> "$LOG"; }
notify() { bash "$REPO_DIR/scripts/self-update.sh" notify "$1" >/dev/null 2>&1 || true; }

command -v sleep >/dev/null 2>&1 && sleep "$DELAY"

log "restart bot (commit ${NEW})"
$DC up -d --no-deps --force-recreate bot >>"$LOG" 2>&1

ok=0
i=1
while [ "$i" -le "$TIMEOUT" ]; do
  if curl -fsS -m 3 "$HEALTH_URL" >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
  i=$((i + 1))
done

if [ "$ok" = "1" ]; then
  log "deploy OK (commit ${NEW})"
  printf 'deployed-ok %s commit=%s\n' "$(date -Is)" "$NEW" > "$STATUS_FILE"
  notify "Self-update sukses. Commit ${NEW} live."
else
  log "HEALTH GAGAL -> rollback ke ${PREV:0:7}"
  git reset --hard "$PREV" >>"$LOG" 2>&1
  $DC up -d --no-deps --force-recreate bot >>"$LOG" 2>&1
  printf 'rolled-back %s prev=%s\n' "$(date -Is)" "${PREV:0:7}" > "$STATUS_FILE"
  notify "Self-update GAGAL health check - sudah di-rollback ke ${PREV:0:7}. Cek data/self-update.log."
fi
