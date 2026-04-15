#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${HETANG_ROOT_DIR:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
RUNTIME_ENV_FILE="${HETANG_RUNTIME_ENV_FILE:-${ROOT_DIR}/.env.runtime}"
HERMES_HOME_DIR="${HETANG_HERMES_HOME_DIR:-${ROOT_DIR}/.hermes-runtime}"
HERMES_HOME_BASE="${HETANG_HERMES_HOME_BASE:-/root/hermes-agent/.sandbox-home}"
HERMES_BIN="${HETANG_HERMES_BIN:-${HERMES_HOME_BASE}/.local/bin/hermes}"
NODE_BIN="${HETANG_NODE_BIN:-/root/.volta/tools/image/node/24.13.1/bin/node}"
HERMES_WECOM_BOT_ID_FILE="${HERMES_WECOM_BOT_ID_FILE:-/root/.hermes/credentials/wecom-hetang-bot-id.txt}"
HERMES_WECOM_SECRET_FILE="${HERMES_WECOM_SECRET_FILE:-/root/.hermes/credentials/wecom-hetang-bot-secret.txt}"

if [[ -f "${RUNTIME_ENV_FILE}" ]]; then
  set -a
  source "${RUNTIME_ENV_FILE}"
  set +a
fi

if [[ -z "${WECOM_BOT_ID:-}" && -f "${HERMES_WECOM_BOT_ID_FILE}" ]]; then
  export WECOM_BOT_ID="$(tr -d '\r\n' < "${HERMES_WECOM_BOT_ID_FILE}")"
fi

if [[ -z "${WECOM_SECRET:-}" && -f "${HERMES_WECOM_SECRET_FILE}" ]]; then
  export WECOM_SECRET="$(tr -d '\r\n' < "${HERMES_WECOM_SECRET_FILE}")"
fi

export HERMES_ENABLE_PROJECT_PLUGINS=true
export HOME="${HETANG_HERMES_OS_HOME:-${HERMES_HOME_DIR}}"
export HERMES_HOME="${HERMES_HOME_DIR}"
export PATH="${HERMES_HOME_BASE}/.local/bin:${PATH}"
export PYTHONPATH="${ROOT_DIR}/hermes_overrides${PYTHONPATH:+:${PYTHONPATH}}"

cd "${ROOT_DIR}"
if [[ -x "${NODE_BIN}" && -f "${ROOT_DIR}/scripts/print-hermes-gateway-runtime.ts" ]]; then
  "${NODE_BIN}" --import tsx "${ROOT_DIR}/scripts/print-hermes-gateway-runtime.ts" || true
fi
exec "${HERMES_BIN}" gateway run --replace
