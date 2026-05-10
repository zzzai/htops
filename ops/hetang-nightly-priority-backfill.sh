#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${HETANG_ROOT_DIR:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
RUNTIME_ENV_FILE="${HETANG_RUNTIME_ENV_FILE:-${ROOT_DIR}/.env.runtime}"
LOG_FILE="${HETANG_PRIORITY_BACKFILL_LOG:-${ROOT_DIR}/logs/nightly-priority-backfill.log}"
LOCK_FILE="${HETANG_PRIORITY_BACKFILL_LOCK:-/tmp/hetang-nightly-priority-backfill.lock}"
HOME="${HOME:-/root}"
NODE_BIN="${HETANG_NODE_BIN:-${HOME}/.volta/bin/node}"

export HOME
export PATH="${HOME}/.volta/bin:/usr/local/bin:/usr/bin:/bin:${HOME}/.local/bin:${HOME}/.npm-global/bin:${PATH:-}"

if [[ -f "${RUNTIME_ENV_FILE}" ]]; then
  set -a
  source "${RUNTIME_ENV_FILE}"
  set +a
fi

if [[ ! -x "${NODE_BIN}" ]]; then
  NODE_BIN="$(command -v node)"
fi

mkdir -p "$(dirname "${LOG_FILE}")"
exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  echo "[$(date '+%F %T')] skip: nightly priority backfill already running" >> "${LOG_FILE}"
  exit 0
fi

cd "${ROOT_DIR}"

{
  echo "[$(date '+%F %T')] start"

  "${NODE_BIN}" --import tsx scripts/nightly-priority-backfill.ts "$@"

  echo "[$(date '+%F %T')] done"
} >> "${LOG_FILE}" 2>&1
