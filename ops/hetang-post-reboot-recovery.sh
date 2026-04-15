#!/usr/bin/env bash
set -euo pipefail

HTOPS_ROOT_DIR="${HETANG_ROOT_DIR:-/root/htops}"
RUNTIME_ENV_FILE="${HETANG_RUNTIME_ENV_FILE:-${HTOPS_ROOT_DIR}/.env.runtime}"
LOG_FILE="${HETANG_RECOVERY_LOG:-/tmp/hetang-post-reboot-recovery.log}"
LOCK_FILE="${HETANG_RECOVERY_LOCK:-/tmp/hetang-post-reboot-recovery.lock}"
BOOT_WAIT_SECONDS="${HETANG_RECOVERY_BOOT_WAIT_SECONDS:-45}"

export PATH="${HOME}/.volta/bin:/usr/local/bin:/usr/bin:/bin:${HOME}/.local/bin:${HOME}/.npm-global/bin:${PATH:-}"

if [[ -f "${RUNTIME_ENV_FILE}" ]]; then
  set -a
  source "${RUNTIME_ENV_FILE}"
  set +a
fi

ROOT_DIR="${HETANG_GATEWAY_ROOT_DIR:-}"
SERVICE_NAME="${HETANG_GATEWAY_SERVICE_NAME:-}"
DIST_ENTRY="${HETANG_GATEWAY_DIST_ENTRY:-}"
if [[ -z "${DIST_ENTRY}" && -n "${ROOT_DIR}" ]]; then
  DIST_ENTRY="${ROOT_DIR}/dist/index.js"
fi

mkdir -p "$(dirname "${LOG_FILE}")"
exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  echo "[$(date '+%F %T')] skip: reboot recovery already running" >> "${LOG_FILE}"
  exit 0
fi

cd "${ROOT_DIR}"

{
  echo "[$(date '+%F %T')] start"

  sleep "${BOOT_WAIT_SECONDS}"

  if [[ -z "${SERVICE_NAME}" || -z "${DIST_ENTRY}" ]]; then
    echo "[$(date '+%F %T')] gateway recovery config missing: set HETANG_GATEWAY_SERVICE_NAME and HETANG_GATEWAY_DIST_ENTRY or HETANG_GATEWAY_ROOT_DIR" >&2
    exit 1
  fi

  if [[ ! -f "${DIST_ENTRY}" ]]; then
    echo "[$(date '+%F %T')] dist entry missing: ${DIST_ENTRY}" >&2
    exit 1
  fi

  if ! systemctl is-active --quiet "${SERVICE_NAME}"; then
    echo "[$(date '+%F %T')] ${SERVICE_NAME} not active, resetting failed state and restarting"
    systemctl reset-failed "${SERVICE_NAME}" || true
    systemctl restart "${SERVICE_NAME}"
    sleep 10
  fi

  systemctl is-active --quiet "${SERVICE_NAME}"
  echo "[$(date '+%F %T')] ${SERVICE_NAME} active"

  echo "[$(date '+%F %T')] done"
} >> "${LOG_FILE}" 2>&1
