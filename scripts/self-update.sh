#!/usr/bin/env bash
# John Mustard — self-update pipeline (host-side, VPS).
#
# Owner-triggered from WhatsApp via the bot -> Hermes -> this script.
# Never exposes anything publicly; runs entirely on the VPS host.
#
# Subcommands:
#   status            print last deploy status + recent log
#   deploy            commit working tree, run test gate, then restart bot (detached)
#   notify <message>  best-effort WhatsApp ping via WAHA (used by the watcher)
#
# Env overrides:
#   SELF_UPDATE_RESTART_DELAY   seconds to wait before restarting the bot (default 20)
#   SELF_UPDATE_HEALTH_TIMEOUT  health-check poll attempts, 2s apart (default 60)
set -uo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

DATA_DIR="$REPO_DIR/data"
LOG="$DATA_DIR/self-update.log"
STATUS_FILE="$DATA_DIR/self-update.status"
LOCK_FILE="$DATA_DIR/.self-update.lock"
HEALTH_URL="http://127.0.0.1:4500/health"
TEST_IMAGE="node:24-slim"
RESTART_DELAY="${SELF_UPDATE_RESTART_DELAY:-20}"
HEALTH_TIMEOUT="${SELF_UPDATE_HEALTH_TIMEOUT:-60}"
PROTECTED=".env docker-compose.yml"

mkdir -p "$DATA_DIR"

if docker compose version >/dev/null 2>&1; then DC="docker compose"; else DC="docker-compose"; fi

ts() { date -Is; }
log() { printf '%s | %s\n' "$(ts)" "$*" | tee -a "$LOG"; }
set_status() { printf '%s\n' "$*" > "$STATUS_FILE"; }
envval() { grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2-; }

# Owner phone: mirror db.js resolution order (OWNER_PHONE -> PRIMARY_USER_PHONE -> first ALLOWED_PHONE)
owner_phone() {
  local o
  o="$(envval OWNER_PHONE)"
  [ -z "$o" ] && o="$(envval PRIMARY_USER_PHONE)"
  [ -z "$o" ] && o="$(envval ALLOWED_PHONE | cut -d, -f1)"
  printf '%s' "$o" | tr -d '+ ' | tr -d '\r\n'
}

cmd_notify() {
  local msg="${1:-}"
  [ -z "$msg" ] && return 0
  local key owner payload
  key="$(envval WAHA_API_KEY)"
  owner="$(owner_phone)"
  [ -z "$owner" ] && return 0
  payload="$(MSG="$msg" OWNER="$owner" python3 -c 'import json,os;print(json.dumps({"session":"default","chatId":os.environ["OWNER"]+"@c.us","text":os.environ["MSG"]}))' 2>/dev/null)" || return 0
  # WAHA is published on the host loopback (compose: 3000:3000)
  curl -s -m 10 -X POST "http://127.0.0.1:3000/api/sendText" \
    -H "Content-Type: application/json" \
    ${key:+-H "x-api-key: $key"} \
    -d "$payload" >/dev/null 2>&1 || true
}

cmd_status() {
  echo "=== Self-Update Status ==="
  if [ -f "$STATUS_FILE" ]; then cat "$STATUS_FILE"; else echo "(belum ada status)"; fi
  echo "HEAD: $(git rev-parse --short HEAD) | branch: $(git branch --show-current)"
  echo "Dirty files: $(git status --porcelain | wc -l)"
  echo "--- 8 log terakhir ---"
  if [ -f "$LOG" ]; then tail -8 "$LOG"; else echo "(log kosong)"; fi
}

cmd_deploy() {
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    echo "SKIP: deploy lain masih berjalan."
    log "SKIP deploy: lock held"
    return 3
  fi

  # 1) Guard: protected files must never be touched by self-update
  if ! git diff --quiet -- $PROTECTED; then
    echo "ABORT: file terproteksi berubah ($PROTECTED). Beresin manual dulu."
    log "ABORT: protected file dirty ($PROTECTED)"
    return 4
  fi

  # 2) Nothing to deploy?
  if [ -z "$(git status --porcelain)" ]; then
    echo "Tidak ada perubahan untuk di-deploy."
    log "no-op: working tree clean"
    set_status "no-op $(ts) head=$(git rev-parse --short HEAD)"
    return 0
  fi

  # 3) Commit the proposed change (rollback anchor = previous HEAD)
  local prev new stat
  prev="$(git rev-parse HEAD)"
  git add -A
  stat="$(git diff --cached --stat | tail -1 | sed 's/^ *//')"
  git -c user.name='John Mustard Self-Update' -c user.email='selfupdate@john-mustard.local' \
      commit -q -m "self-update: ${stat:-auto}" || true
  new="$(git rev-parse --short HEAD)"
  log "commit ${new} (prev ${prev:0:7}) :: ${stat}"

  # 4) Test gate (node unit tests in a throwaway container; node is not on the host)
  echo "Menjalankan test gate (${TEST_IMAGE})..."
  if ! docker run --rm -v "$REPO_DIR":/app -w /app "$TEST_IMAGE" sh -c 'node --test tests/*.test.js' 2>&1 | tail -20; then
    log "TEST GAGAL -> rollback ke ${prev:0:7}"
    git reset --hard "$prev" >/dev/null 2>&1
    set_status "test-failed-rolled-back $(ts) prev=${prev:0:7}"
    echo "TEST GAGAL. Perubahan dibatalkan (rollback ke ${prev:0:7})."
    return 5
  fi
  log "test lulus (${new})"

  # 5) Only a change under src/ needs a container restart (src is bind-mounted;
  #    system-prompt.md/config are re-read per request).
  if [ -z "$(git diff --name-only "$prev" "$new" | grep '^src/' || true)" ]; then
    log "deploy OK (${new}) - no src/ change, restart dilewati"
    set_status "deployed-ok $(ts) commit=${new} (no-restart-needed)"
    echo "TEST LULUS. Gak ada perubahan di src/ - restart bot dilewati."
    return 0
  fi

  # 6) Schedule detached restart + health check + auto-rollback
  set_status "pending-restart $(ts) commit=${new} prev=${prev:0:7}"
  echo "TEST LULUS. Bot restart dalam ${RESTART_DELAY}s (commit ${new})."
  echo "Cek hasil dengan: #deploy status"
  setsid bash "$REPO_DIR/scripts/self-update-watch.sh" "$prev" "$new" "$RESTART_DELAY" "$HEALTH_TIMEOUT" \
    >/dev/null 2>&1 < /dev/null &
  return 0
}

case "${1:-status}" in
  status) cmd_status ;;
  deploy) cmd_deploy ;;
  notify) cmd_notify "${2:-}" ;;
  *) echo "Usage: self-update.sh [status|deploy|notify <msg>]" ;;
esac
