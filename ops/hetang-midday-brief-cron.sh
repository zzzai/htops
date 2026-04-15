#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${HETANG_ROOT_DIR:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
RUNTIME_ENV_FILE="${HETANG_RUNTIME_ENV_FILE:-${ROOT_DIR}/.env.runtime}"
TARGET_GROUP="${HETANG_MIDDAY_TARGET:-龙虾测试群}"
TARGET_CHAT_ID="${HETANG_MIDDAY_TARGET_CHAT_ID:-REPLACE_WITH_SHARED_DELIVERY_TARGET}"
LOG_FILE="${HETANG_MIDDAY_LOG:-/tmp/hetang-midday-brief-cron.log}"
LOCK_FILE="${HETANG_MIDDAY_LOCK:-/tmp/hetang-midday-brief-cron.lock}"
NODE_BIN="${HETANG_NODE_BIN:-${HOME}/.volta/bin/node}"
LATE_UNTIL="${HETANG_MIDDAY_LATE_UNTIL:-13:00}"

export PATH="${HOME}/.volta/bin:/usr/local/bin:/usr/bin:/bin:${HOME}/.local/bin:${HOME}/.npm-global/bin:${PATH:-}"

if [[ -f "${RUNTIME_ENV_FILE}" ]]; then
  set -a
  source "${RUNTIME_ENV_FILE}"
  set +a
fi

cd "${ROOT_DIR}"
exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  echo "[$(date '+%F %T')] skip: midday brief cron already running" >> "${LOG_FILE}"
  exit 0
fi

{
  echo "[$(date '+%F %T')] start target=${TARGET_GROUP} chat_id=${TARGET_CHAT_ID} late_until=${LATE_UNTIL}"

  if [[ ! -x "${NODE_BIN}" ]]; then
    echo "[$(date '+%F %T')] node binary missing: ${NODE_BIN}" >&2
    exit 1
  fi

  "${NODE_BIN}" --import tsx scripts/send-midday-briefs.ts \
    --channel wecom \
    --target "${TARGET_CHAT_ID}" \
    --late-until "${LATE_UNTIL}"

  echo "[$(date '+%F %T')] done"
} >> "${LOG_FILE}" 2>&1
