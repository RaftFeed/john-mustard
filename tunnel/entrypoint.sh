#!/bin/sh
set -e

KEY_SRC="${SSH_KEY_PATH:-/key/ssh-key-2026-08-26.key}"
SSH_HOST="${SSH_HOST:?SSH_HOST is required}"
SSH_USER="${SSH_USER:-ubuntu}"
SSH_PORT="${SSH_PORT:-22}"
LOCAL_PORT="${LOCAL_PORT:-8642}"
REMOTE_HOST="${REMOTE_HOST:-127.0.0.1}"
REMOTE_PORT="${REMOTE_PORT:-8642}"

if [ ! -f "$KEY_SRC" ]; then
  echo "[tunnel] Private key not found at $KEY_SRC" >&2
  exit 1
fi

# Bind-mounted keys keep host permissions (often 0777); OpenSSH refuses those,
# so copy to a private location with 0600 before connecting.
mkdir -p /root/.ssh
cp "$KEY_SRC" /root/.ssh/id_key
chmod 600 /root/.ssh/id_key

echo "[tunnel] Forwarding 0.0.0.0:${LOCAL_PORT} -> ${SSH_HOST}:${REMOTE_PORT} as ${SSH_USER}"

exec ssh -N -g \
  -p "$SSH_PORT" \
  -o StrictHostKeyChecking=accept-new \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -o ExitOnForwardFailure=yes \
  -o IdentitiesOnly=yes \
  -o BatchMode=yes \
  -i /root/.ssh/id_key \
  -L "0.0.0.0:${LOCAL_PORT}:${REMOTE_HOST}:${REMOTE_PORT}" \
  "${SSH_USER}@${SSH_HOST}"
