import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(repoRoot, "scripts/summarize-route-compare.ts");

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) {
      continue;
    }
    await fs.rm(dir, { recursive: true, force: true });
  }
});

async function writeBridgeLog(lines: string[]): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "route-compare-summary-"));
  tempDirs.push(tempDir);

  const logPath = path.join(tempDir, "htops-bridge.log");
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

describe("summarize-route-compare script", () => {
  it("supports reading route compare events from an explicit log file", async () => {
    const logPath = await writeBridgeLog([
      "plain log line",
      '2026-04-15T19:05:00.000Z info hetang-ops: route-compare {"routingMode":"shadow","latencyMs":46,"legacyRoute":"query:query","semanticRoute":"query:query","legacyCapabilityId":"store_day_summary_v1","selectedCapabilityId":"store_day_summary_v1","selectedLane":"query","clarificationNeeded":false}',
      '2026-04-15T19:05:10.000Z info hetang-ops: route-compare {"routingMode":"shadow","latencyMs":88,"legacyRoute":"query:query","semanticRoute":"analysis:analysis","legacyCapabilityId":"store_day_summary_v1","selectedCapabilityId":"store_review_async_v1","selectedLane":"analysis","clarificationNeeded":true}',
    ]);

    const result = runScript(["--log-file", logPath, "--json"]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      total: 2,
      routeMatchCount: 1,
      routeDiffCount: 1,
      routeAccuracyPercent: 50,
      clarificationNeededCount: 1,
      latencyP50Ms: 46,
      latencyP95Ms: 88,
      selectedLanes: [
        { key: "analysis", count: 1 },
        { key: "query", count: 1 },
      ],
    });
  });
});
