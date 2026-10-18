#!/usr/bin/env bash
# Start the backend API (:8000) and the frontend (:5173) together; Ctrl-C stops both.
# The front page is live (this backend + Modal) unless its Demo mode switch is on.
set -euo pipefail
cd "$(dirname "$0")"
(cd backend && uv sync -q && uv run litmus serve) &
backend_pid=$!
trap 'kill $backend_pid 2>/dev/null' EXIT
until curl -s localhost:8000/api/health >/dev/null; do sleep 1; done
(cd backend && uv run litmus warmup) &
cd frontend && npm install --silent && npx vite --port 5173
