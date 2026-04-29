import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

const ROOT_DIR = "/root/htops";
const SCRIPT_PATH = join(ROOT_DIR, "ops/install-host-cron.sh");

function createFakeCrontabBin(spoolPath: string, binDir: string): void {
  const scriptPath = join(binDir, "crontab");
  writeFileSync(
    scriptPath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `SPOOL_PATH=${JSON.stringify(spoolPath)}`,
      "if [[ \"${1:-}\" == \"-l\" ]]; then",
      "  if [[ -f \"${SPOOL_PATH}\" ]]; then",
      "    cat \"${SPOOL_PATH}\"",
      "  else",
      "    exit 1",
      "  fi",
      "  exit 0",
      "fi",
      "if [[ $# -eq 1 ]]; then",
      "  cat \"$1\" > \"${SPOOL_PATH}\"",
      "  exit 0",
      "fi",
      "echo \"unsupported crontab args: $*\" >&2",
      "exit 2",
      "",
    ].join("\n"),
    "utf8",
  );
  chmodSync(scriptPath, 0o755);
}

describe("ops/install-host-cron.sh", () => {
  it("removes the legacy daytime repair cron block while keeping managed boot/watchdog entries", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "htops-install-host-cron-"));
    const binDir = join(tempDir, "bin");
    const spoolPath = join(tempDir, "crontab.txt");
    execFileSync("mkdir", ["-p", binDir]);
    createFakeCrontabBin(spoolPath, binDir);
    writeFileSync(
      spoolPath,
      [
        "# custom begin",
        "*/30 * * * * echo custom",
        "# custom end",
        "",
        "# HETANG_DAYTIME_REPAIR_BEGIN",
        "* * * * * /root/htops/ops/hetang-daytime-repair-missing-cron.sh",
        "# HETANG_DAYTIME_REPAIR_END",
        "",
        "# HETANG_BOOT_RECOVERY_BEGIN",
        "@reboot /stale/boot.sh",
        "# HETANG_BOOT_RECOVERY_END",
        "",
        "# HETANG_GATEWAY_WATCHDOG_BEGIN",
        "*/5 * * * * /stale/watchdog.sh",
        "# HETANG_GATEWAY_WATCHDOG_END",
        "",
      ].join("\n"),
      "utf8",
    );

    try {
      execFileSync("bash", [SCRIPT_PATH], {
        cwd: ROOT_DIR,
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH ?? ""}`,
          HETANG_ROOT_DIR: ROOT_DIR,
        },
        stdio: "pipe",
      });

      const updated = readFileSync(spoolPath, "utf8");
      expect(updated).toContain("*/30 * * * * echo custom");
      expect(updated).toContain("# HETANG_BOOT_RECOVERY_BEGIN");
      expect(updated).toContain("@reboot /root/htops/ops/hetang-post-reboot-recovery.sh");
      expect(updated).toContain("# HETANG_GATEWAY_WATCHDOG_BEGIN");
      expect(updated).toContain("*/5 * * * * /root/htops/ops/hetang-gateway-watchdog.sh");
      expect(updated).not.toContain("# HETANG_DAYTIME_REPAIR_BEGIN");
      expect(updated).not.toContain("hetang-daytime-repair-missing-cron.sh");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
