#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${HETANG_ROOT_DIR:-/root/htops}"
RUNTIME_ENV_FILE="${HETANG_RUNTIME_ENV_FILE:-${ROOT_DIR}/.env.runtime}"
LOG_FILE="${HETANG_SCHEDULED_WORKER_LOG:-/tmp/hetang-scheduled-worker.log}"
LOCK_FILE="${HETANG_SCHEDULED_WORKER_LOCK:-/tmp/hetang-scheduled-worker.lock}"
NODE_BIN="${HETANG_NODE_BIN:-${HOME}/.volta/bin/node}"
DIST_ENTRY="${HETANG_SCHEDULED_WORKER_ENTRY:-${ROOT_DIR}/dist/scripts/run-worker-service.js}"
SOURCE_ENTRY="${HETANG_SCHEDULED_WORKER_SOURCE:-${ROOT_DIR}/scripts/run-worker-service.ts}"

export PATH="${HOME}/.volta/bin:/usr/local/bin:/usr/bin:/bin:${HOME}/.local/bin:${HOME}/.npm-global/bin:${PATH:-}"

if [[ -f "${RUNTIME_ENV_FILE}" ]]; then
  set -a
  source "${RUNTIME_ENV_FILE}"
  set +a
fi

mkdir -p "$(dirname "${LOG_FILE}")"
exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  echo "[$(date '+%F %T')] skip: scheduled worker already running" >> "${LOG_FILE}"
  exit 0
fi

cd "${ROOT_DIR}"
{
  echo "[$(date '+%F %T')] start scheduled worker"
  if [[ ! -x "${NODE_BIN}" ]]; then
    echo "[$(date '+%F %T')] node binary missing: ${NODE_BIN}" >&2
    exit 1
  fi
  if [[ -f "${DIST_ENTRY}" ]]; then
    exec "${NODE_BIN}" "${DIST_ENTRY}" --mode scheduled
  fi
  exec "${NODE_BIN}" --import tsx "${SOURCE_ENTRY}" --mode scheduled
} >> "${LOG_FILE}" 2>&1
