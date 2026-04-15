#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${HETANG_ROOT_DIR:-/root/htops}"
RUNTIME_ENV_FILE="${HETANG_RUNTIME_ENV_FILE:-${ROOT_DIR}/.env.runtime}"
HOST="${HETANG_QUERY_API_HOST:-127.0.0.1}"
PORT="${HETANG_QUERY_API_PORT:-18890}"
LOG_FILE="${HETANG_QUERY_API_LOG:-/tmp/hetang-query-api.log}"
LOCK_FILE="${HETANG_QUERY_API_LOCK:-/tmp/hetang-query-api.lock}"
DEFAULT_VENV_PYTHON="${ROOT_DIR}/api/.venv/bin/python"
PYTHON_BIN="${HETANG_QUERY_API_PYTHON:-${DEFAULT_VENV_PYTHON}}"
CONFIG_PATH="${HTOPS_CONFIG_PATH:-${ROOT_DIR}/htops.json}"

if [[ -f "${RUNTIME_ENV_FILE}" ]]; then
  set -a
  source "${RUNTIME_ENV_FILE}"
  set +a
fi

mkdir -p "$(dirname "${LOG_FILE}")"
exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  echo "[$(date '+%F %T')] skip: query api already running" >> "${LOG_FILE}"
  exit 0
fi

cd "${ROOT_DIR}"
{
  echo "[$(date '+%F %T')] start query api"
  if [[ ! -x "${PYTHON_BIN}" ]]; then
    echo "[$(date '+%F %T')] python binary missing: ${PYTHON_BIN}" >&2
    exit 1
  fi
  if [[ -z "${HETANG_QUERY_DATABASE_URL:-${QUERY_DATABASE_URL:-${DATABASE_URL:-${HETANG_DATABASE_URL:-}}}}" ]]; then
    if [[ -f "${CONFIG_PATH}" ]]; then
      export HETANG_QUERY_DATABASE_URL="$("${PYTHON_BIN}" - "${CONFIG_PATH}" <<'PY'
import json
import sys

config_path = sys.argv[1]
with open(config_path, "r", encoding="utf-8") as handle:
    root = json.load(handle)

database = root.get("database", {})

value = database.get("queryUrl") or database.get("url") or ""
print(value, end="")
PY
)"
      if [[ -n "${HETANG_QUERY_DATABASE_URL}" ]]; then
        echo "[$(date '+%F %T')] loaded query api database url from ${CONFIG_PATH}"
      fi
    fi
  fi
  if [[ -z "${HETANG_QUERY_DATABASE_URL:-${QUERY_DATABASE_URL:-${DATABASE_URL:-${HETANG_DATABASE_URL:-}}}}" ]]; then
    echo "[$(date '+%F %T')] missing query api database url; set HETANG_QUERY_DATABASE_URL or database.queryUrl in ${CONFIG_PATH}" >&2
    exit 1
  fi
  exec "${PYTHON_BIN}" -m uvicorn main:app \
    --host "${HOST}" \
    --port "${PORT}" \
    --app-dir "${ROOT_DIR}/api"
} >> "${LOG_FILE}" 2>&1
