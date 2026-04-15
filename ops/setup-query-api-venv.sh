#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${HETANG_ROOT_DIR:-/root/htops}"
VENV_DIR="${HETANG_QUERY_API_VENV:-${ROOT_DIR}/api/.venv}"
PYTHON_BIN="${HETANG_QUERY_API_BOOTSTRAP_PYTHON:-/usr/bin/python3}"
PIP_INDEX_URL="${HETANG_PIP_INDEX_URL:-https://pypi.tuna.tsinghua.edu.cn/simple}"
REQUIREMENTS_FILE="${ROOT_DIR}/api/requirements.txt"

if [[ ! -f "${REQUIREMENTS_FILE}" ]]; then
  echo "requirements file missing: ${REQUIREMENTS_FILE}" >&2
  exit 1
fi

if [[ ! -x "${PYTHON_BIN}" ]]; then
  echo "python binary missing: ${PYTHON_BIN}" >&2
  exit 1
fi

rm -rf "${VENV_DIR}"
"${PYTHON_BIN}" -m venv "${VENV_DIR}"
"${VENV_DIR}/bin/pip" install --upgrade pip
"${VENV_DIR}/bin/pip" install -i "${PIP_INDEX_URL}" -r "${REQUIREMENTS_FILE}"

echo "query api venv ready: ${VENV_DIR}"
