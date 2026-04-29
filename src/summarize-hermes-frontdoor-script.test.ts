import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(repoRoot, "scripts/summarize-hermes-frontdoor.ts");

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) {
      continue;
    }
    await fs.rm(dir, { recursive: true, force: true });
  }
});

async function writeGatewayLog(lines: string[]): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-frontdoor-summary-"));
  tempDirs.push(tempDir);

  const logPath = path.join(tempDir, "gateway.log");
  await fs.writeFile(logPath, `${lines.join("\n")}\n`, "utf8");
  return logPath;
}

function runScript(args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", scriptPath, ...args], {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
  });
}

describe("summarize-hermes-frontdoor script", () => {
  it("supports reading Hermes frontdoor events from an explicit log file", async () => {
    const logPath = await writeGatewayLog([
      "plain log line",
      "2026-04-16 19:10:00,000 INFO sitecustomize: htops_hermes_frontdoor lane=general-simple reason=greeting chat_id=chat-1 user_id=user-1",
      "2026-04-16 19:10:01,000 INFO sitecustomize: htops_hermes_frontdoor lane=general-lite reason=explanatory-question chat_id=chat-1 user_id=user-1",
      "2026-04-16 19:10:02,000 INFO sitecustomize: htops_hermes_frontdoor lane=full-hermes reason=complex-request chat_id=chat-2 user_id=user-2",
    ]);

    const result = runScript(["--log-file", logPath, "--json"]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      total: 3,
      uniqueChats: 2,
      uniqueUsers: 2,
      lanes: [
        { key: "full-hermes", count: 1 },
        { key: "general-lite", count: 1 },
        { key: "general-simple", count: 1 },
      ],
    });
  });
});
