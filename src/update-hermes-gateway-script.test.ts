import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

const ROOT_DIR = "/root/htops";
const SCRIPT_PATH = join(ROOT_DIR, "ops/update-hermes-gateway.sh");

function createTempGitRepo(repoDir: string): void {
  execFileSync("git", ["init"], { cwd: repoDir, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "tests@example.com"], {
    cwd: repoDir,
    stdio: "pipe",
  });
  execFileSync("git", ["config", "user.name", "HTOPS Tests"], {
    cwd: repoDir,
    stdio: "pipe",
  });
  writeFileSync(join(repoDir, "README.md"), "# fake hermes source\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: repoDir, stdio: "pipe" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: repoDir, stdio: "pipe" });
}

function createFakeHermes(binDir: string, tempDir: string): {
  hermesPath: string;
  logPath: string;
  versionPath: string;
  configPath: string;
  envPath: string;
} {
  const hermesPath = join(binDir, "hermes");
  const logPath = join(tempDir, "hermes.log");
  const versionPath = join(tempDir, "version.txt");
  const configPath = join(tempDir, "config.yaml");
  const envPath = join(tempDir, ".env");
  writeFileSync(versionPath, "Hermes Agent vold\n", "utf8");
  writeFileSync(configPath, "model:\n  default: qwen3.5\n", "utf8");
  writeFileSync(envPath, "OPENAI_API_KEY=test-key\n", "utf8");

  writeFileSync(
    hermesPath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `LOG_PATH=${JSON.stringify(logPath)}`,
      `VERSION_PATH=${JSON.stringify(versionPath)}`,
      `CONFIG_PATH=${JSON.stringify(configPath)}`,
      `ENV_PATH=${JSON.stringify(envPath)}`,
      "echo \"$*\" >> \"${LOG_PATH}\"",
      "if [[ $# -eq 1 && \"$1\" == \"--version\" ]]; then",
      "  cat \"${VERSION_PATH}\"",
      "  exit 0",
      "fi",
      "if [[ \"$1\" == \"config\" && \"$2\" == \"path\" ]]; then",
      "  echo \"${CONFIG_PATH}\"",
      "  exit 0",
      "fi",
      "if [[ \"$1\" == \"config\" && \"$2\" == \"env-path\" ]]; then",
      "  echo \"${ENV_PATH}\"",
      "  exit 0",
      "fi",
      "if [[ \"$1\" == \"config\" && \"$2\" == \"check\" ]]; then",
      "  echo \"config ok\"",
      "  exit 0",
      "fi",
      "if [[ \"$1\" == \"config\" && \"$2\" == \"migrate\" ]]; then",
      "  echo \"config migrated\"",
      "  exit 0",
      "fi",
      "if [[ \"$1\" == \"doctor\" ]]; then",
      "  echo \"doctor ok\"",
      "  exit 0",
      "fi",
      "if [[ \"$1\" == \"update\" ]]; then",
      "  printf 'Hermes Agent vnew\\n' > \"${VERSION_PATH}\"",
      "  echo \"update ok\"",
      "  exit 0",
      "fi",
      "echo \"unsupported hermes args: $*\" >&2",
      "exit 2",
      "",
    ].join("\n"),
    "utf8",
  );
  chmodSync(hermesPath, 0o755);
  return { hermesPath, logPath, versionPath, configPath, envPath };
}

function createFakeSystemctl(binDir: string, tempDir: string): string {
  const systemctlPath = join(binDir, "systemctl");
  const logPath = join(tempDir, "systemctl.log");
  writeFileSync(
    systemctlPath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `LOG_PATH=${JSON.stringify(logPath)}`,
      "echo \"$*\" >> \"${LOG_PATH}\"",
      "if [[ \"$1\" == \"restart\" || \"$1\" == \"reset-failed\" ]]; then",
      "  exit 0",
      "fi",
      "if [[ \"$1\" == \"is-active\" ]]; then",
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

describe("ops/update-hermes-gateway.sh", () => {
  it("runs the Hermes update flow, backs up config, and restarts the gateway service", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "htops-hermes-update-"));
    const binDir = join(tempDir, "bin");
    const hermesHomeDir = join(tempDir, "hermes-home");
    const sourceDir = join(tempDir, "hermes-source");
    mkdirSync(binDir, { recursive: true });
    mkdirSync(hermesHomeDir, { recursive: true });
    mkdirSync(sourceDir, { recursive: true });
    createTempGitRepo(sourceDir);
    const fakeHermes = createFakeHermes(binDir, tempDir);
    const systemctlLogPath = createFakeSystemctl(binDir, tempDir);

    try {
      const output = execFileSync("bash", [SCRIPT_PATH], {
        cwd: ROOT_DIR,
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH ?? ""}`,
          HETANG_ROOT_DIR: ROOT_DIR,
          HETANG_NODE_BIN: process.execPath,
          HETANG_HERMES_BIN: fakeHermes.hermesPath,
          HETANG_HERMES_HOME_DIR: hermesHomeDir,
          HETANG_HERMES_SOURCE_DIR: sourceDir,
          HETANG_GATEWAY_SERVICE_NAME: "hermes-gateway.service",
        },
        stdio: "pipe",
      }).toString();

      expect(output).toContain("before_version=Hermes Agent vold");
      expect(output).toContain("after_version=Hermes Agent vnew");
      expect(output).toContain("service_restart=performed");

      const hermesLog = readFileSync(fakeHermes.logPath, "utf8");
      expect(hermesLog).toContain("config check");
      expect(hermesLog).toContain("doctor");
      expect(hermesLog).toContain("update");

      const systemctlLog = readFileSync(systemctlLogPath, "utf8");
      expect(systemctlLog).toContain("restart hermes-gateway.service");
      expect(systemctlLog).toContain("is-active --quiet hermes-gateway.service");

      const backupRoot = join(hermesHomeDir, ".converge-backups");
      const backupEntries = execFileSync("find", [backupRoot, "-maxdepth", "2", "-type", "f"], {
        stdio: "pipe",
      })
        .toString()
        .trim()
        .split("\n")
        .filter(Boolean);
      expect(backupEntries.some((entry) => entry.endsWith("/config.yaml"))).toBe(true);
      expect(backupEntries.some((entry) => entry.endsWith("/.env"))).toBe(true);
      expect(backupEntries.some((entry) => entry.endsWith("/rollback.env"))).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("refuses to update a dirty Hermes source tree unless explicitly allowed", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "htops-hermes-update-dirty-"));
    const binDir = join(tempDir, "bin");
    const hermesHomeDir = join(tempDir, "hermes-home");
    const sourceDir = join(tempDir, "hermes-source");
    mkdirSync(binDir, { recursive: true });
    mkdirSync(hermesHomeDir, { recursive: true });
    mkdirSync(sourceDir, { recursive: true });
    createTempGitRepo(sourceDir);
    writeFileSync(join(sourceDir, "README.md"), "# dirty\n", "utf8");
    const fakeHermes = createFakeHermes(binDir, tempDir);
    createFakeSystemctl(binDir, tempDir);

    try {
      expect(() =>
        execFileSync("bash", [SCRIPT_PATH], {
          cwd: ROOT_DIR,
          env: {
            ...process.env,
            PATH: `${binDir}:${process.env.PATH ?? ""}`,
            HETANG_ROOT_DIR: ROOT_DIR,
            HETANG_NODE_BIN: process.execPath,
            HETANG_HERMES_BIN: fakeHermes.hermesPath,
            HETANG_HERMES_HOME_DIR: hermesHomeDir,
            HETANG_HERMES_SOURCE_DIR: sourceDir,
            HETANG_GATEWAY_SERVICE_NAME: "hermes-gateway.service",
          },
          stdio: "pipe",
        }),
      ).toThrowError(/dirty/i);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
