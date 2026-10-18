#!/usr/bin/env bash
# Start the backend API (:8000) and the frontend (:5173) together; Ctrl-C stops both.
# The front page is live (this backend + Modal) unless its Demo mode switch is on.
set -euo pipefail
cd "$(dirname "$0")"
# a second run would quietly talk to the first one's (possibly stale) backend: stop instead
for port in 8000 5173; do
  if lsof -iTCP:$port -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $port is already in use (another ./dev.sh?). Stop it first: lsof -iTCP:$port -sTCP:LISTEN" >&2
    exit 1
  fi
done
(cd backend && uv sync -q && uv run litmus serve) &
backend_pid=$!
trap 'kill $backend_pid 2>/dev/null' EXIT
until curl -s localhost:8000/api/health >/dev/null; do sleep 1; done
(cd backend && uv run litmus warmup) &
cd frontend && npm install --silent && npx vite --port 5173 --strictPort
