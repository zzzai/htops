#!/usr/bin/env bash
set -euo pipefail

cd /root/htops
set -a
if [[ -f /root/htops/.env.runtime ]]; then
  source /root/htops/.env.runtime
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
