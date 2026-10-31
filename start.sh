#!/usr/bin/env bash
# GridRescue AI - one-command start (Linux / macOS). Backend on http://127.0.0.1:8000, app on http://localhost:5173.
# Offline demo (no internet APIs):  GR_OFFLINE=1 ./start.sh        Stop: Ctrl+C
# Another app port if 5173 is taken:  GR_UI_PORT=5180 ./start.sh
set -e
cd "$(dirname "$0")"
UI_PORT="${GR_UI_PORT:-5173}"

command -v python3 >/dev/null || { echo "Python 3.11 or newer is needed: https://www.python.org/downloads/"; exit 1; }
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' || { echo "Python 3.11 or newer is needed."; exit 1; }
command -v npm >/dev/null || { echo "Node.js 20.19 or newer is needed (22 LTS recommended): https://nodejs.org/"; exit 1; }

echo "[1/4] Backend: Python packages..."
[ -x backend/.venv/bin/python ] || python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -q --disable-pip-version-check -r backend/requirements.txt

echo "[2/4] Frontend: Node packages..."
( cd frontend && { [ -d node_modules/@mediapipe/tasks-vision ] || npm ci --no-audit --no-fund; } && node scripts/copy-mediapipe.mjs )
mkdir -p frontend/public/models
[ -f frontend/public/models/gesture_recognizer.task ] || curl -sL -o frontend/public/models/gesture_recognizer.task   https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task || true

echo "[3/4] Starting the backend and the app..."
( cd backend && exec .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 ) &
( cd frontend && exec npm run dev -- --port "$UI_PORT" --strictPort ) &
trap 'kill $(jobs -p) 2>/dev/null' EXIT INT TERM

echo "[4/4] Waiting for both servers..."
for _ in $(seq 1 90); do
  if curl -sf http://127.0.0.1:8000/health >/dev/null && curl -sf "http://localhost:$UI_PORT/" >/dev/null; then break; fi
  sleep 2
done
echo "App:      http://localhost:$UI_PORT"
echo "API docs: http://localhost:8000/docs"
wait
