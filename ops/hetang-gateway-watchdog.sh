#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HTOPS_ROOT_DIR="${HETANG_ROOT_DIR:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
RUNTIME_ENV_FILE="${HETANG_RUNTIME_ENV_FILE:-${HTOPS_ROOT_DIR}/.env.runtime}"
LOG_FILE="${HETANG_WATCHDOG_LOG:-/tmp/hetang-gateway-watchdog.log}"
LOCK_FILE="${HETANG_WATCHDOG_LOCK:-/tmp/hetang-gateway-watchdog.lock}"
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
  echo "[$(date '+%F %T')] skip: watchdog already running" >> "${LOG_FILE}"
  exit 0
fi

{
  if [[ ! -x "${NODE_BIN}" ]]; then
    echo "[$(date '+%F %T')] node binary missing: ${NODE_BIN}" >&2
    exit 1
  fi

  TARGET_ENV="$("${NODE_BIN}" --import tsx "${HTOPS_ROOT_DIR}/scripts/resolve-gateway-recovery.ts")"
  eval "${TARGET_ENV}"

  echo "[$(date '+%F %T')] start service=${SERVICE_NAME} mode=${RECOVERY_MODE}"

  if [[ -z "${SERVICE_NAME}" || -z "${CHECK_PATH}" ]]; then
    echo "[$(date '+%F %T')] gateway watchdog config missing after policy resolution" >&2
    exit 1
  fi

  if systemctl is-active --quiet "${SERVICE_NAME}"; then
    echo "[$(date '+%F %T')] ${SERVICE_NAME} already active"
    exit 0
  fi

  if [[ ! -f "${CHECK_PATH}" ]]; then
    echo "[$(date '+%F %T')] recovery check path missing: ${CHECK_PATH}" >&2
    exit 1
  fi

  echo "[$(date '+%F %T')] ${SERVICE_NAME} inactive, resetting failed state and restarting"
  systemctl reset-failed "${SERVICE_NAME}" || true
  systemctl restart "${SERVICE_NAME}"
  sleep 10
  systemctl is-active --quiet "${SERVICE_NAME}"

  echo "[$(date '+%F %T')] ${SERVICE_NAME} recovered"
} >> "${LOG_FILE}" 2>&1
