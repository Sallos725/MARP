#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

PYTHON_BIN="${PYTHON_BIN:-python3}"
VENV_DIR="${VENV_DIR:-.venv}"
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-6009}"
CONFIG_PATH="${CONFIG_PATH:-$PWD/data/config.json}"

if [ ! -f ".env" ] && [ -f ".env.example" ]; then
  cp ".env.example" ".env"
  echo "Created full/.env from .env.example. Edit it with your provider settings before production use."
fi

if [ ! -d "$VENV_DIR" ]; then
  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"

python -m pip install --upgrade pip
python -m pip install -r requirements.txt

mkdir -p "$(dirname "$CONFIG_PATH")"
export CONFIG_PATH

exec python -m uvicorn app.main:app --host "$HOST" --port "$PORT"
