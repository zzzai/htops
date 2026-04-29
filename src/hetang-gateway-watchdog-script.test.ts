import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

const ROOT_DIR = "/root/htops";
const SCRIPT_PATH = join(ROOT_DIR, "ops/hetang-gateway-watchdog.sh");

function createFakeNode(binDir: string, tempDir: string, expectedCwd: string): string {
  const nodePath = join(binDir, "node");
  const logPath = join(tempDir, "node.log");
  writeFileSync(
    nodePath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `LOG_PATH=${JSON.stringify(logPath)}`,
      `EXPECTED_CWD=${JSON.stringify(expectedCwd)}`,
      "echo \"cwd=$PWD args=$*\" >> \"${LOG_PATH}\"",
      "if [[ \"$PWD\" != \"${EXPECTED_CWD}\" ]]; then",
      "  echo \"wrong cwd: $PWD\" >&2",
      "  exit 91",
      "fi",
      "cat <<'EOF'",
      "SERVICE_NAME='hermes-gateway.service'",
      `CHECK_PATH='${expectedCwd}/ops/hermes-gateway.sh'`,
      "RECOVERY_MODE='hermes'",
      "EOF",
      "",
    ].join("\n"),
    "utf8",
  );
  chmodSync(nodePath, 0o755);
  return logPath;
}

function createFakeSystemctl(binDir: string, tempDir: string): string {
  const systemctlPath = join(binDir, "systemctl");
  const logPath = join(tempDir, "systemctl.log");
  const statePath = join(tempDir, "systemctl.state");
  writeFileSync(statePath, "inactive\n", "utf8");
  writeFileSync(
    systemctlPath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `LOG_PATH=${JSON.stringify(logPath)}`,
      `STATE_PATH=${JSON.stringify(statePath)}`,
      "echo \"$*\" >> \"${LOG_PATH}\"",
      "if [[ \"$1\" == \"is-active\" && \"$2\" == \"--quiet\" ]]; then",
      "  if [[ \"$(cat \"${STATE_PATH}\")\" == \"active\" ]]; then",
      "    exit 0",
      "  fi",
      "  exit 1",
      "fi",
      "if [[ \"$1\" == \"reset-failed\" || \"$1\" == \"restart\" ]]; then",
      "  if [[ \"$1\" == \"restart\" ]]; then",
      "    printf 'active\\n' > \"${STATE_PATH}\"",
      "  fi",
      "  exit 0",
      "fi",
      "echo \"unsupported systemctl args: $*\" >&2",
      "exit 2",
      "",
    ].join("\n"),
    "utf8",
  );
  chmodSync(systemctlPath, 0o755);
  return logPath;
}

function createFakeSleep(binDir: string, tempDir: string): string {
  const sleepPath = join(binDir, "sleep");
  const logPath = join(tempDir, "sleep.log");
  writeFileSync(
    sleepPath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `LOG_PATH=${JSON.stringify(logPath)}`,
      "echo \"$*\" >> \"${LOG_PATH}\"",
      "",
    ].join("\n"),
    "utf8",
  );
  chmodSync(sleepPath, 0o755);
  return logPath;
}

describe("ops/hetang-gateway-watchdog.sh", () => {
  it("resolves the recovery target from the repo root so tsx is discovered", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "htops-gateway-watchdog-"));
    const binDir = join(tempDir, "bin");
    const runtimeRoot = join(tempDir, "repo");
    const runtimeEnvPath = join(tempDir, ".env.runtime");
    const logPath = join(tempDir, "watchdog.log");
    mkdirSync(binDir, { recursive: true });
    mkdirSync(join(runtimeRoot, "ops"), { recursive: true });
    writeFileSync(join(runtimeRoot, "ops/hermes-gateway.sh"), "#!/usr/bin/env bash\n", "utf8");
    chmodSync(join(runtimeRoot, "ops/hermes-gateway.sh"), 0o755);
    writeFileSync(runtimeEnvPath, "", "utf8");
    const nodeLogPath = createFakeNode(binDir, tempDir, runtimeRoot);
    const systemctlLogPath = createFakeSystemctl(binDir, tempDir);
    const sleepLogPath = createFakeSleep(binDir, tempDir);

    try {
      execFileSync("bash", [SCRIPT_PATH], {
        cwd: "/root",
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH ?? ""}`,
          HETANG_ROOT_DIR: runtimeRoot,
          HETANG_RUNTIME_ENV_FILE: runtimeEnvPath,
          HETANG_WATCHDOG_LOG: logPath,
          HETANG_NODE_BIN: join(binDir, "node"),
          HETANG_SYSTEMCTL_BIN: join(binDir, "systemctl"),
          HETANG_SLEEP_BIN: join(binDir, "sleep"),
        },
        stdio: "pipe",
      });

      const nodeLog = readFileSync(nodeLogPath, "utf8");
      expect(nodeLog).toContain(`cwd=${runtimeRoot}`);

      const systemctlLog = readFileSync(systemctlLogPath, "utf8");
      expect(systemctlLog).toContain("is-active --quiet hermes-gateway.service");
      expect(systemctlLog).toContain("reset-failed hermes-gateway.service");
      expect(systemctlLog).toContain("restart hermes-gateway.service");

      const sleepLog = readFileSync(sleepLogPath, "utf8");
      expect(sleepLog).toContain("10");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
