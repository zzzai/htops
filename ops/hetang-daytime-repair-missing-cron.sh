#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${HETANG_ROOT_DIR:-/root/htops}"
RUNTIME_ENV_FILE="${HETANG_RUNTIME_ENV_FILE:-${ROOT_DIR}/.env.runtime}"
LOG_FILE="${HETANG_DAYTIME_REPAIR_LOG:-/tmp/hetang-daytime-repair-missing-cron.log}"
LOCK_FILE="${HETANG_DAYTIME_REPAIR_LOCK:-/tmp/hetang-daytime-repair-missing-cron.lock}"
NODE_BIN="${HETANG_NODE_BIN:-${HOME}/.volta/bin/node}"
MAX_PLANS="${HETANG_DAYTIME_REPAIR_MAX_PLANS:-2}"
ORG_ID="${HETANG_DAYTIME_REPAIR_ORG_ID:-}"
START_BIZ_DATE="${HETANG_DAYTIME_REPAIR_START_BIZ_DATE:-}"
END_BIZ_DATE="${HETANG_DAYTIME_REPAIR_END_BIZ_DATE:-}"

export PATH="${HOME}/.volta/bin:/usr/local/bin:/usr/bin:/bin:${HOME}/.local/bin:${HOME}/.npm-global/bin:${PATH:-}"

if [[ -f "${RUNTIME_ENV_FILE}" ]]; then
  set -a
  source "${RUNTIME_ENV_FILE}"
  set +a
fi

mkdir -p "$(dirname "${LOG_FILE}")"
exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  echo "[$(date '+%F %T')] skip: daytime repair already running" >> "${LOG_FILE}"
  exit 0
fi

cd "${ROOT_DIR}"

ARGS=(--import tsx src/main.ts hetang repair-missing --max-plans "${MAX_PLANS}")
if [[ -n "${ORG_ID}" ]]; then
  ARGS+=(--org "${ORG_ID}")
fi
if [[ -n "${START_BIZ_DATE}" ]]; then
  ARGS+=(--start "${START_BIZ_DATE}")
fi
if [[ -n "${END_BIZ_DATE}" ]]; then
  ARGS+=(--end "${END_BIZ_DATE}")
fi

{
  echo "[$(date '+%F %T')] start maxPlans=${MAX_PLANS}${ORG_ID:+ org=${ORG_ID}}${START_BIZ_DATE:+ start=${START_BIZ_DATE}}${END_BIZ_DATE:+ end=${END_BIZ_DATE}}"

  if [[ ! -x "${NODE_BIN}" ]]; then
    echo "[$(date '+%F %T')] node binary missing: ${NODE_BIN}" >&2
    exit 1
  fi

  "${NODE_BIN}" "${ARGS[@]}"

  echo "[$(date '+%F %T')] done"
} >> "${LOG_FILE}" 2>&1
