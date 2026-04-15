#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${HETANG_ROOT_DIR:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
RUNTIME_ENV_FILE="${HETANG_RUNTIME_ENV_FILE:-${ROOT_DIR}/.env.runtime}"
LOG_FILE="${HETANG_HISTORY_CATCHUP_LOG:-/tmp/hetang-customer-history-catchup-cron.log}"
LOCK_FILE="${HETANG_HISTORY_CATCHUP_LOCK:-/tmp/hetang-customer-history-catchup-cron.lock}"
NODE_BIN="${HETANG_NODE_BIN:-${HOME}/.volta/bin/node}"
CHUNK_DAYS="${HETANG_HISTORY_CATCHUP_CHUNK_DAYS:-14}"
START_BIZ_DATE="${HETANG_HISTORY_CATCHUP_START:-}"
END_BIZ_DATE="${HETANG_HISTORY_CATCHUP_END:-}"
ORG_IDS_CSV="${HETANG_HISTORY_CATCHUP_ORGS:-}"

export PATH="${HOME}/.volta/bin:/usr/local/bin:/usr/bin:/bin:${HOME}/.local/bin:${HOME}/.npm-global/bin:${PATH:-}"

if [[ -f "${RUNTIME_ENV_FILE}" ]]; then
  set -a
  source "${RUNTIME_ENV_FILE}"
  set +a
fi

mkdir -p "$(dirname "${LOG_FILE}")"
exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  echo "[$(date '+%F %T')] skip: customer history catchup already running" >> "${LOG_FILE}"
  exit 0
fi

cd "${ROOT_DIR}"

args=(--intelligence-chunk-days "${CHUNK_DAYS}")
if [[ -n "${START_BIZ_DATE}" || -n "${END_BIZ_DATE}" ]]; then
  if [[ -z "${START_BIZ_DATE}" || -z "${END_BIZ_DATE}" ]]; then
    echo "[$(date '+%F %T')] invalid override: start/end must be provided together" >> "${LOG_FILE}"
    exit 1
  fi
  args+=(--start "${START_BIZ_DATE}" --end "${END_BIZ_DATE}")
fi

if [[ -n "${ORG_IDS_CSV}" ]]; then
  IFS=',' read -r -a org_ids <<< "${ORG_IDS_CSV}"
  for org_id in "${org_ids[@]}"; do
    org_id_trimmed="$(echo "${org_id}" | xargs)"
    if [[ -n "${org_id_trimmed}" ]]; then
      args+=(--org "${org_id_trimmed}")
    fi
  done
fi

{
  echo "[$(date '+%F %T')] start chunk_days=${CHUNK_DAYS} start_override=${START_BIZ_DATE:-default} end_override=${END_BIZ_DATE:-default} orgs=${ORG_IDS_CSV:-all-active}"

  if [[ ! -x "${NODE_BIN}" ]]; then
    echo "[$(date '+%F %T')] node binary missing: ${NODE_BIN}" >&2
    exit 1
  fi

  "${NODE_BIN}" --import tsx scripts/rebuild-customer-history-local.ts "${args[@]}"

  echo "[$(date '+%F %T')] done"
} >> "${LOG_FILE}" 2>&1
