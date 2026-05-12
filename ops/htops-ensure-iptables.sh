#!/usr/bin/env sh
set -eu

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"

ensure_entrypoint() {
  master="$1"
  alternative="$2"
  fallback="$3"

  if [ -x "$master" ]; then
    return 0
  fi

  if [ -e "$alternative" ]; then
    ln -sfn "$alternative" "$master"
  elif [ -e "$fallback" ]; then
    ln -sfn "$fallback" "$master"
  fi
}

if command -v update-alternatives >/dev/null 2>&1; then
  update-alternatives --auto iptables >/dev/null 2>&1 || true
  update-alternatives --auto ip6tables >/dev/null 2>&1 || true
fi

ensure_entrypoint /usr/sbin/iptables /etc/alternatives/iptables /usr/sbin/iptables-nft
ensure_entrypoint /usr/sbin/ip6tables /etc/alternatives/ip6tables /usr/sbin/ip6tables-nft
ensure_entrypoint /usr/sbin/iptables-save /etc/alternatives/iptables-save /usr/sbin/iptables-nft-save
ensure_entrypoint /usr/sbin/iptables-restore /etc/alternatives/iptables-restore /usr/sbin/iptables-nft-restore
ensure_entrypoint /usr/sbin/ip6tables-save /etc/alternatives/ip6tables-save /usr/sbin/ip6tables-nft-save
ensure_entrypoint /usr/sbin/ip6tables-restore /etc/alternatives/ip6tables-restore /usr/sbin/ip6tables-nft-restore

for binary in /usr/sbin/iptables /usr/sbin/ip6tables; do
  if [ ! -x "$binary" ]; then
    echo "$binary is missing or not executable" >&2
    exit 1
  fi
  "$binary" --version >/dev/null 2>&1 || {
    echo "$binary exists but cannot execute correctly" >&2
    exit 1
  }
done
