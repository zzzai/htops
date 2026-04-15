#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${ROOT_DIR}"
set -a
if [[ -f "${ROOT_DIR}/.env.runtime" ]]; then
  source "${ROOT_DIR}/.env.runtime"
fi
set +a

# systemd and other non-interactive launchers often omit Volta/Homebrew paths.
export PATH="$HOME/.volta/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"

NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
if [[ -z "$NODE_BIN" ]]; then
  echo "run-backfill.sh: node binary not found in PATH=$PATH" >&2
  exit 127
fi

exec "$NODE_BIN" --import tsx scripts/backfill-and-rebuild.ts "$@"
