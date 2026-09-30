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

# Push a commit to GitHub. Best-effort: without a deploy key / credential on the VPS
# this just logs a warning and the commit stays local (never blocks a deploy).
push_origin() {
  local ref="${1:-HEAD}"
  if GIT_TERMINAL_PROMPT=0 git -c credential.helper= push --quiet origin "${ref}:main" >>"$LOG" 2>&1; then
    log "pushed ${ref} -> origin/main"
  else
    log "warn: push gagal (credential belum diset) - commit ${ref} tetap lokal di VPS"
  fi
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

  # 2) Pull from GitHub first. Fast-forward only, and never while a self-update edit
  #    is pending (uncommitted work must never be discarded).
  local prev
  prev="$(git rev-parse HEAD)"
  if [ -z "$(git status --porcelain)" ]; then
    if git -c credential.helper= fetch --quiet origin 2>/dev/null; then
      if ! git merge --ff-only --quiet origin/main 2>/dev/null; then
        echo "ABORT: origin/main divergen dari VPS. Merge manual dulu."
        log "ABORT: origin/main diverged from VPS, manual merge needed"
        return 6
      fi
    else
      log "warn: git fetch gagal (offline?) - lanjut tanpa sync"
    fi
  else
    log "pending self-update terdeteksi - auto-pull dilewati"
  fi

  # 3) Nothing pending?
  if [ -z "$(git status --porcelain)" ]; then
    if [ "$(git rev-parse HEAD)" != "$prev" ] && [ -n "$(git diff --name-only "$prev" HEAD | grep '^src/' || true)" ]; then
      local pulled
      pulled="$(git rev-parse HEAD)"
      set_status "pending-restart $(ts) commit=${pulled:0:7} prev=${prev:0:7} (pulled)"
      log "sync: pulled src/ changes -> schedule restart (${pulled:0:7})"
      echo "Sync GitHub: ada perubahan src/. Bot restart dalam ${RESTART_DELAY}s."
      setsid bash "$REPO_DIR/scripts/self-update-watch.sh" "$prev" "$pulled" "$RESTART_DELAY" "$HEALTH_TIMEOUT" \
        >/dev/null 2>&1 < /dev/null &
      return 0
    fi
    echo "Sudah sinkron dengan GitHub dan gak ada perubahan."
    log "no-op: in sync, clean tree"
    set_status "no-op $(ts) head=$(git rev-parse --short HEAD)"
    return 0
  fi

  # 4) Commit the pending change (rollback anchor = previous HEAD)
  local new stat
  git add -A
  stat="$(git diff --cached --stat | tail -1 | sed 's/^ *//')"
  git -c user.name='John Mustard Self-Update' -c user.email='selfupdate@john-mustard.local' \
      commit -q -m "self-update: ${stat:-auto}" || true
  new="$(git rev-parse --short HEAD)"
  log "commit ${new} (prev ${prev:0:7}) :: ${stat}"

  # 5) Test gate (node unit tests in a throwaway container; node is not on the host)
  echo "Menjalankan test gate (${TEST_IMAGE})..."
  if ! docker run --rm -v "$REPO_DIR":/app -w /app "$TEST_IMAGE" sh -c 'node --test tests/*.test.js' 2>&1 | tail -20; then
    log "TEST GAGAL -> rollback ke ${prev:0:7}"
    git reset --hard "$prev" >/dev/null 2>&1
    set_status "test-failed-rolled-back $(ts) prev=${prev:0:7}"
    echo "TEST GAGAL. Perubahan dibatalkan (rollback ke ${prev:0:7})."
    return 5
  fi
  log "test lulus (${new})"

  # 6) Only a change under src/ needs a container restart (src is bind-mounted;
  #    system-prompt.md/config are re-read per request).
  if [ -z "$(git diff --name-only "$prev" "$new" | grep '^src/' || true)" ]; then
    push_origin "$new"
    log "deploy OK (${new}) - no src/ change, restart dilewati"
    set_status "deployed-ok $(ts) commit=${new} (no-restart-needed)"
    echo "TEST LULUS. Gak ada perubahan di src/ - restart bot dilewati."
    return 0
  fi

  # 7) Restart with health check + auto-rollback.
  #    Detached by default, because the bot must flush its WhatsApp reply before it dies.
  #    Synchronous when SELF_UPDATE_SYNC_RESTART=1 (CI caller wants a truthful exit code).
  set_status "pending-restart $(ts) commit=${new} prev=${prev:0:7}"
  if [ "${SELF_UPDATE_SYNC_RESTART:-0}" = "1" ]; then
    local rc=0
    bash "$REPO_DIR/scripts/self-update-watch.sh" "$prev" "$new" 0 "$HEALTH_TIMEOUT" || rc=$?
    if [ "$rc" = "0" ]; then
      echo "Deploy OK (commit ${new})."
    else
      echo "Deploy GAGAL, sudah di-rollback ke ${prev:0:7}."
    fi
    return "$rc"
  fi
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
  push) push_origin "${2:-HEAD}" ;;
  *) echo "Usage: self-update.sh [status|deploy|notify <msg>|push <ref>]" ;;
esac
