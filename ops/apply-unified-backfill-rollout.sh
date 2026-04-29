#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${HETANG_ROOT_DIR:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
SERVICE_NAME="${HETANG_SCHEDULED_WORKER_SERVICE_NAME:-htops-scheduled-worker.service}"

log() {
  echo "[unified-backfill-rollout] $*"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log "missing required command: $1"
    exit 1
  fi
}

main() {
  require_cmd bash
  require_cmd crontab

  cd "${ROOT_DIR}"

  log "updating host cron entries"
  bash "${ROOT_DIR}/ops/install-host-cron.sh"

  local crontab_snapshot
  crontab_snapshot="$(crontab -l 2>/dev/null || true)"
  if grep -q "# HETANG_DAYTIME_REPAIR_BEGIN" <<<"${crontab_snapshot}"; then
    log "daytime repair cron block still present after install"
    exit 1
  fi
  log "confirmed daytime repair cron block removed"

  if ! command -v systemctl >/dev/null 2>&1; then
    log "systemctl unavailable; cron update is applied, restart ${SERVICE_NAME} manually"
    return 0
  fi

  log "reloading systemd units"
  systemctl daemon-reload

  log "restarting ${SERVICE_NAME}"
  systemctl restart "${SERVICE_NAME}"
  systemctl is-active --quiet "${SERVICE_NAME}"
  log "${SERVICE_NAME} is active"

  if command -v journalctl >/dev/null 2>&1; then
    log "recent ${SERVICE_NAME} logs"
    journalctl -u "${SERVICE_NAME}" -n 20 --no-pager || true
  fi
}

main "$@"
