#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${HETANG_ROOT_DIR:-/root/htops}"
RUNTIME_ENV_FILE="${HETANG_RUNTIME_ENV_FILE:-${ROOT_DIR}/.env.runtime}"
LOG_FILE="${HETANG_NIGHTLY_SYNC_LOG:-/tmp/hetang-nightly-sync-cron.log}"
LOCK_FILE="${HETANG_NIGHTLY_SYNC_LOCK:-/tmp/hetang-nightly-sync-cron.lock}"
NODE_BIN="${HETANG_NODE_BIN:-${HOME}/.volta/bin/node}"

export PATH="${HOME}/.volta/bin:/usr/local/bin:/usr/bin:/bin:${HOME}/.local/bin:${HOME}/.npm-global/bin:${PATH:-}"

if [[ -f "${RUNTIME_ENV_FILE}" ]]; then
  set -a
  source "${RUNTIME_ENV_FILE}"
  set +a
fi

mkdir -p "$(dirname "${LOG_FILE}")"
exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  echo "[$(date '+%F %T')] skip: nightly sync already running" >> "${LOG_FILE}"
  exit 0
fi

cd "${ROOT_DIR}"

{
  echo "[$(date '+%F %T')] start"

  if [[ ! -x "${NODE_BIN}" ]]; then
    echo "[$(date '+%F %T')] node binary missing: ${NODE_BIN}" >&2
    exit 1
  fi

  "${NODE_BIN}" --import tsx scripts/run-due-jobs.ts

  echo "[$(date '+%F %T')] done"
} >> "${LOG_FILE}" 2>&1
