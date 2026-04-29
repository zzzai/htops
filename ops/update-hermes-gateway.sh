#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${HETANG_ROOT_DIR:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
RUNTIME_ENV_FILE="${HETANG_RUNTIME_ENV_FILE:-${ROOT_DIR}/.env.runtime}"
NODE_BIN="${HETANG_NODE_BIN:-${HOME}/.volta/bin/node}"
HERMES_HOME_DIR="${HETANG_HERMES_HOME_DIR:-/root/.hermes}"
HERMES_SOURCE_DIR="${HETANG_HERMES_SOURCE_DIR:-${HERMES_HOME_DIR}/hermes-agent}"
HERMES_BIN="${HETANG_HERMES_BIN:-/root/hermes-agent/.sandbox-home/.local/bin/hermes}"
LOG_FILE="${HETANG_HERMES_UPDATE_LOG:-/tmp/hermes-gateway-update.log}"

export PATH="${PATH:-}:${HOME}/.volta/bin:/usr/local/bin:/usr/bin:/bin:${HOME}/.local/bin:${HOME}/.cargo/bin"

DRY_RUN=false
SKIP_RESTART=false
ALLOW_DIRTY=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      SKIP_RESTART=true
      shift
      ;;
    --skip-restart)
      SKIP_RESTART=true
      shift
      ;;
    --allow-dirty)
      ALLOW_DIRTY=true
      shift
      ;;
    *)
      echo "unknown arg: $1" >&2
      echo "usage: $0 [--dry-run] [--skip-restart] [--allow-dirty]" >&2
      exit 2
      ;;
  esac
done

if [[ -f "${RUNTIME_ENV_FILE}" ]]; then
  set -a
  source "${RUNTIME_ENV_FILE}"
  set +a
fi

mkdir -p "$(dirname "${LOG_FILE}")"
touch "${LOG_FILE}"

log() {
  printf '[%s] %s\n' "$(date '+%F %T')" "$*" | tee -a "${LOG_FILE}" >&2
}

print_kv() {
  printf '%s=%s\n' "$1" "$2"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log "missing required command: $1"
    exit 1
  fi
}

run_cmd() {
  if [[ "${DRY_RUN}" == "true" ]]; then
    log "dry-run: $*"
    return 0
  fi
  "$@"
}

trim_first_line() {
  head -n 1 | tr -d '\r'
}

copy_if_exists() {
  local source_path="$1"
  local target_dir="$2"
  if [[ -n "${source_path}" && -f "${source_path}" ]]; then
    cp "${source_path}" "${target_dir}/"
  fi
}

if [[ ! -x "${HERMES_BIN}" ]]; then
  log "Hermes binary missing or not executable: ${HERMES_BIN}"
  exit 1
fi

if [[ ! -d "${HERMES_SOURCE_DIR}" ]]; then
  log "Hermes source dir missing: ${HERMES_SOURCE_DIR}"
  exit 1
fi

require_cmd git

if [[ ! -x "${NODE_BIN}" ]]; then
  log "node binary missing: ${NODE_BIN}"
  exit 1
fi

TARGET_ENV="$("${NODE_BIN}" --import tsx "${ROOT_DIR}/scripts/resolve-gateway-recovery.ts")"
eval "${TARGET_ENV}"

if [[ -z "${SERVICE_NAME:-}" ]]; then
  log "failed to resolve gateway service name"
  exit 1
fi

DIRTY_STATUS="$(git -C "${HERMES_SOURCE_DIR}" status --porcelain)"
if [[ -n "${DIRTY_STATUS}" && "${ALLOW_DIRTY}" != "true" ]]; then
  log "Hermes source tree is dirty; aborting update. Re-run with --allow-dirty after review."
  exit 1
fi

TIMESTAMP="$(date '+%Y%m%d-%H%M%S')"
BACKUP_ROOT="${HETANG_HERMES_UPDATE_BACKUP_ROOT:-${HERMES_HOME_DIR}/.converge-backups}"
if ! mkdir -p "${BACKUP_ROOT}" 2>/dev/null; then
  BACKUP_ROOT="${TMPDIR:-/tmp}/hermes-update-backups"
  mkdir -p "${BACKUP_ROOT}"
  log "backup root under ${HERMES_HOME_DIR} is not writable; using ${BACKUP_ROOT}"
fi
BACKUP_DIR="${BACKUP_ROOT}/hermes-update-${TIMESTAMP}"
if ! mkdir -p "${BACKUP_DIR}" 2>/dev/null; then
  BACKUP_ROOT="${TMPDIR:-/tmp}/hermes-update-backups"
  mkdir -p "${BACKUP_ROOT}"
  BACKUP_DIR="${BACKUP_ROOT}/hermes-update-${TIMESTAMP}"
  mkdir -p "${BACKUP_DIR}"
  log "backup dir under ${HERMES_HOME_DIR} is not writable; using ${BACKUP_DIR}"
fi

BEFORE_COMMIT="$(git -C "${HERMES_SOURCE_DIR}" rev-parse HEAD | tr -d '\r')"
BEFORE_VERSION="$("${HERMES_BIN}" --version | trim_first_line)"
CONFIG_PATH="$("${HERMES_BIN}" config path | trim_first_line)"
ENV_PATH="$("${HERMES_BIN}" config env-path | trim_first_line)"

copy_if_exists "${CONFIG_PATH}" "${BACKUP_DIR}"
copy_if_exists "${ENV_PATH}" "${BACKUP_DIR}"

cat > "${BACKUP_DIR}/rollback.env" <<EOF
HERMES_SOURCE_DIR='${HERMES_SOURCE_DIR}'
HERMES_PREVIOUS_COMMIT='${BEFORE_COMMIT}'
HERMES_GATEWAY_SERVICE='${SERVICE_NAME}'
EOF

print_kv "backup_dir" "${BACKUP_DIR}"
print_kv "service_name" "${SERVICE_NAME}"
print_kv "before_commit" "${BEFORE_COMMIT}"
print_kv "before_version" "${BEFORE_VERSION}"

log "running preflight checks"
run_cmd "${HERMES_BIN}" config check >/dev/null
run_cmd "${HERMES_BIN}" doctor >/dev/null

UPDATE_MODE="hermes-update"
if [[ "${DRY_RUN}" == "true" ]]; then
  log "skipping Hermes update because dry-run is enabled"
else
  if ! "${HERMES_BIN}" update >/dev/null; then
    log "hermes update failed; falling back to manual git/uv update path"
    UPDATE_MODE="git-fallback"
    run_cmd git -C "${HERMES_SOURCE_DIR}" pull --ff-only origin main
    run_cmd git -C "${HERMES_SOURCE_DIR}" submodule update --init --recursive

    UV_CMD=""
    if command -v uv >/dev/null 2>&1; then
      UV_CMD="uv"
    elif [[ -x "${HOME}/.local/bin/uv" ]]; then
      UV_CMD="${HOME}/.local/bin/uv"
    elif [[ -x "${HOME}/.cargo/bin/uv" ]]; then
      UV_CMD="${HOME}/.cargo/bin/uv"
    fi
    if [[ -z "${UV_CMD}" ]]; then
      log "uv not found for manual fallback reinstall"
      exit 1
    fi

    (
      cd "${HERMES_SOURCE_DIR}"
      export VIRTUAL_ENV="${HERMES_SOURCE_DIR}/venv"
      run_cmd "${UV_CMD}" pip install -e ".[all]" >/dev/null
      if [[ -d "${HERMES_SOURCE_DIR}/tinker-atropos" ]]; then
        run_cmd "${UV_CMD}" pip install -e "./tinker-atropos" >/dev/null || true
      fi
    )
  fi
fi

if ! run_cmd "${HERMES_BIN}" config check >/dev/null; then
  log "post-update config check reported new options; attempting migrate"
  run_cmd "${HERMES_BIN}" config migrate >/dev/null
  run_cmd "${HERMES_BIN}" config check >/dev/null
fi
run_cmd "${HERMES_BIN}" doctor >/dev/null

AFTER_COMMIT="$(git -C "${HERMES_SOURCE_DIR}" rev-parse HEAD | tr -d '\r')"
AFTER_VERSION="$("${HERMES_BIN}" --version | trim_first_line)"

SERVICE_RESTART="skipped"
if [[ "${SKIP_RESTART}" == "true" ]]; then
  log "gateway restart skipped by flag"
elif ! command -v systemctl >/dev/null 2>&1; then
  log "systemctl unavailable; restart ${SERVICE_NAME} manually"
  SERVICE_RESTART="manual"
else
  run_cmd systemctl reset-failed "${SERVICE_NAME}" || true
  run_cmd systemctl restart "${SERVICE_NAME}"
  run_cmd systemctl is-active --quiet "${SERVICE_NAME}"
  SERVICE_RESTART="performed"
fi

ROLLBACK_CMD="git -C '${HERMES_SOURCE_DIR}' checkout '${BEFORE_COMMIT}' && git -C '${HERMES_SOURCE_DIR}' submodule update --init --recursive && systemctl restart '${SERVICE_NAME}'"

print_kv "update_mode" "${UPDATE_MODE}"
print_kv "after_commit" "${AFTER_COMMIT}"
print_kv "after_version" "${AFTER_VERSION}"
print_kv "service_restart" "${SERVICE_RESTART}"
print_kv "rollback_file" "${BACKUP_DIR}/rollback.env"
print_kv "rollback_hint" "${ROLLBACK_CMD}"

log "Hermes gateway update flow finished"
