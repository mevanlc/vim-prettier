#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd "$(dirname "$0")/.." && pwd)
REQUIREMENTS_FILE="$ROOT_DIR/requirements-vint.txt"
VENV_DIR=${VINT_VENV_DIR:-$ROOT_DIR/.venv-vint}
PYTHON_BIN=${VINT_PYTHON:-python3}
STAMP_FILE="$VENV_DIR/.requirements-vint.txt"

if [ ! -x "$VENV_DIR/bin/python" ]; then
  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

if [ ! -x "$VENV_DIR/bin/vint" ] || [ ! -f "$STAMP_FILE" ] || ! cmp -s "$REQUIREMENTS_FILE" "$STAMP_FILE"; then
  "$VENV_DIR/bin/python" -m pip install --disable-pip-version-check -r "$REQUIREMENTS_FILE"
  cp "$REQUIREMENTS_FILE" "$STAMP_FILE"
fi

exec "$VENV_DIR/bin/vint" "$@"
