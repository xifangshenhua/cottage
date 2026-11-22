#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p "$ROOT/data" "$ROOT/logs"
PIDFILE="$ROOT/data/house.pid"

if [[ -f "$PIDFILE" ]]; then
  PID="$(cat "$PIDFILE" || true)"
  if [[ -n "${PID:-}" ]] && kill -0 "$PID" 2>/dev/null; then
    echo "house service already running (pid $PID)"
    exit 0
  fi
  rm -f "$PIDFILE"
fi

# Rebuild only when dist is missing or frontend sources are newer than it.
needs_frontend_build() {
  local stamp="$ROOT/dist/index.html"
  if [[ ! -f "$stamp" ]]; then
    return 0
  fi
  local inputs=("$ROOT/src" "$ROOT/index.html" "$ROOT/package.json")
  local cfg
  for cfg in "$ROOT"/vite.config.js "$ROOT"/vite.config.mjs "$ROOT"/vite.config.ts; do
    if [[ -e "$cfg" ]]; then
      inputs+=("$cfg")
    fi
  done
  if find "${inputs[@]}" -type f -newer "$stamp" -print -quit 2>/dev/null | grep -q .; then
    return 0
  fi
  return 1
}

if needs_frontend_build; then
  npm run build
fi

nohup node "$ROOT/server/index.js" >> "$ROOT/logs/house.log" 2>&1 &
echo $! > "$PIDFILE"
sleep 0.3
if ! kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "failed to start; see $ROOT/logs/house.log" >&2
  exit 1
fi
LISTEN_URL="$(node --input-type=module -e "
import { loadSettings } from './server/settings/index.js';
import { resolveListenHost, resolveListenPort } from './server/settings/listen.js';
const settings = loadSettings();
const host = resolveListenHost(settings);
const port = resolveListenPort(process.env);
const shown = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : (host.includes(':') ? '[' + host + ']' : host);
process.stdout.write('http://' + shown + ':' + port);
")"
echo "house service started (pid $(cat "$PIDFILE")) on ${LISTEN_URL}"
