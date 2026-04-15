#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${HETANG_ROOT_DIR:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
BOOT_BEGIN="# HETANG_BOOT_RECOVERY_BEGIN"
BOOT_END="# HETANG_BOOT_RECOVERY_END"
WATCHDOG_BEGIN="# HETANG_GATEWAY_WATCHDOG_BEGIN"
WATCHDOG_END="# HETANG_GATEWAY_WATCHDOG_END"
DAYTIME_REPAIR_BEGIN="# HETANG_DAYTIME_REPAIR_BEGIN"
DAYTIME_REPAIR_END="# HETANG_DAYTIME_REPAIR_END"
BOOT_JOB="@reboot ${ROOT_DIR}/ops/hetang-post-reboot-recovery.sh"
WATCHDOG_JOB="*/5 * * * * ${ROOT_DIR}/ops/hetang-gateway-watchdog.sh"
DAYTIME_REPAIR_JOB="* * * * * ${ROOT_DIR}/ops/hetang-daytime-repair-missing-cron.sh"

current_crontab="$(mktemp)"
next_crontab="$(mktemp)"
trap 'rm -f "${current_crontab}" "${next_crontab}"' EXIT

crontab -l > "${current_crontab}" 2>/dev/null || true

python3 - "${current_crontab}" "${next_crontab}" "${BOOT_JOB}" "${WATCHDOG_JOB}" "${DAYTIME_REPAIR_JOB}" <<'PY'
from pathlib import Path
import sys

current = Path(sys.argv[1]).read_text(encoding="utf-8")
boot_job = sys.argv[3]
watchdog_job = sys.argv[4]
daytime_repair_job = sys.argv[5]

replacements = [
    (
        "# HETANG_BOOT_RECOVERY_BEGIN",
        "# HETANG_BOOT_RECOVERY_END",
        boot_job,
    ),
    (
        "# HETANG_GATEWAY_WATCHDOG_BEGIN",
        "# HETANG_GATEWAY_WATCHDOG_END",
        watchdog_job,
    ),
    (
        "# HETANG_DAYTIME_REPAIR_BEGIN",
        "# HETANG_DAYTIME_REPAIR_END",
        daytime_repair_job,
    ),
]

lines = current.splitlines()
result = []
index = 0
while index < len(lines):
    line = lines[index]
    matched = False
    for begin, end, _job in replacements:
        if line == begin:
            matched = True
            while index < len(lines) and lines[index] != end:
                index += 1
            if index < len(lines):
                index += 1
            break
    if not matched:
        result.append(line)
        index += 1

while result and result[-1] == "":
    result.pop()

if result:
    result.append("")

for begin, end, job in replacements:
    result.extend([begin, job, end, ""])

Path(sys.argv[2]).write_text("\n".join(result).rstrip() + "\n", encoding="utf-8")
PY

crontab "${next_crontab}"
echo "host cron updated to ${ROOT_DIR}/ops entries"
