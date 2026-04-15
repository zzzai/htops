#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${HETANG_ROOT_DIR:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
RUNTIME_ENV_FILE="${HETANG_RUNTIME_ENV_FILE:-${ROOT_DIR}/.env.runtime}"
TARGET_GROUP="${HETANG_REACTIVATION_TARGET:-龙虾测试群}"
TARGET_CHAT_ID="${HETANG_REACTIVATION_TARGET_CHAT_ID:-REPLACE_WITH_SHARED_DELIVERY_TARGET}"
LOG_FILE="${HETANG_REACTIVATION_LOG:-/tmp/hetang-reactivation-push-cron.log}"
LOCK_FILE="${HETANG_REACTIVATION_LOCK:-/tmp/hetang-reactivation-push-cron.lock}"
WECOM_SENDER_SCRIPT="${HETANG_WECOM_GROUP_SENDER:-${ROOT_DIR}/ops/wecom-send-group.mjs}"
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
  echo "[$(date '+%F %T')] skip: reactivation push already running" >> "${LOG_FILE}"
  exit 0
fi

cd "${ROOT_DIR}"

{
  echo "[$(date '+%F %T')] start target=${TARGET_GROUP} chat_id=${TARGET_CHAT_ID}"

  if [[ ! -x "${NODE_BIN}" ]]; then
    echo "[$(date '+%F %T')] node binary missing: ${NODE_BIN}" >&2
    exit 1
  fi

  if [[ ! -f "${WECOM_SENDER_SCRIPT}" ]]; then
    echo "[$(date '+%F %T')] sender script missing: ${WECOM_SENDER_SCRIPT}" >&2
    exit 1
  fi

  mapfile -t ORG_IDS < <(
    "${NODE_BIN}" -e '
      const fs = require("node:fs");
      const os = require("node:os");
      const path = require("node:path");
      const rootDir = process.env.HTOPS_ROOT_DIR || process.env.HETANG_ROOT_DIR || process.cwd();
      const configPath = process.env.HTOPS_CONFIG_PATH || path.join(rootDir, "htops.json");
      const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
      const stores = raw?.stores ?? [];
      for (const store of stores) {
        if (store && store.isActive !== false && typeof store.orgId === "string") {
          console.log(store.orgId);
        }
      }
    '
  )

  if [[ "${#ORG_IDS[@]}" -eq 0 ]]; then
    echo "[$(date '+%F %T')] no active hetang stores found in config" >&2
    exit 1
  fi

  failures=0
  for org_id in "${ORG_IDS[@]}"; do
    message="$(
      "${NODE_BIN}" --import tsx scripts/send-reactivation-picks.ts \
        --org "${org_id}" \
        --message-only
    )"
    echo "[$(date '+%F %T')] sending org=${org_id}"
    if ! "${NODE_BIN}" "${WECOM_SENDER_SCRIPT}" "${TARGET_CHAT_ID}" "${message}"; then
      failures=$((failures + 1))
      echo "[$(date '+%F %T')] failed org=${org_id}" >&2
    fi
  done

  if [[ "${failures}" -gt 0 ]]; then
    echo "[$(date '+%F %T')] done with failures=${failures}" >&2
    exit 1
  fi

  echo "[$(date '+%F %T')] done"
} >> "${LOG_FILE}" 2>&1
