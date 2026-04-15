#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${HETANG_ROOT_DIR:-/root/htops}"
RUNTIME_ENV_FILE="${HETANG_RUNTIME_ENV_FILE:-${ROOT_DIR}/.env.runtime}"
LOG_FILE="${HETANG_TOOLS_LOG:-/tmp/htops-tools.log}"
LOCK_FILE="${HETANG_TOOLS_LOCK:-/tmp/htops-tools.lock}"
NODE_BIN="${HETANG_NODE_BIN:-${HOME}/.volta/bin/node}"
DIST_ENTRY="${HETANG_TOOLS_ENTRY:-${ROOT_DIR}/dist/scripts/run-tools-service.js}"
SOURCE_ENTRY="${HETANG_TOOLS_SOURCE:-${ROOT_DIR}/scripts/run-tools-service.ts}"

export PATH="${HOME}/.volta/bin:/usr/local/bin:/usr/bin:/bin:${HOME}/.local/bin:${HOME}/.npm-global/bin:${PATH:-}"

if [[ -f "${RUNTIME_ENV_FILE}" ]]; then
  set -a
  source "${RUNTIME_ENV_FILE}"
  set +a
fi

mkdir -p "$(dirname "${LOG_FILE}")"
exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  echo "[$(date '+%F %T')] skip: tools already running" >> "${LOG_FILE}"
  exit 0
fi

cd "${ROOT_DIR}"
{
  echo "[$(date '+%F %T')] start tools"
  if [[ ! -x "${NODE_BIN}" ]]; then
    echo "[$(date '+%F %T')] node binary missing: ${NODE_BIN}" >&2
    exit 1
  fi
  if [[ -f "${DIST_ENTRY}" ]]; then
    exec "${NODE_BIN}" "${DIST_ENTRY}"
  fi
  exec "${NODE_BIN}" --import tsx "${SOURCE_ENTRY}"
} >> "${LOG_FILE}" 2>&1
