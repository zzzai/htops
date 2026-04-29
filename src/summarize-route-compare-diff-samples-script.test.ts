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
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "route-compare-diff-samples-"));
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

describe("summarize-route-compare diff samples", () => {
  it("can emit actionable diff samples in json output", async () => {
    const logPath = await writeBridgeLog([
      '2026-04-15T19:05:00.000Z info hetang-ops: route-compare {"routingMode":"shadow","latencyMs":46,"rawText":"义乌店昨天营收多少","legacyRoute":"query:query","semanticRoute":"query:query","legacyCapabilityId":"store_day_summary_v1","selectedCapabilityId":"store_day_summary_v1"}',
      '2026-04-15T19:05:10.000Z info hetang-ops: route-compare {"routingMode":"shadow","latencyMs":88,"rawText":"迎宾店这几天怎么样","frontDoorDecision":"legacy_pass","legacyRoute":"query:query","semanticRoute":"analysis:analysis","legacyCapabilityId":"store_day_summary_v1","selectedCapabilityId":"store_review_async_v1"}',
      '2026-04-15T19:05:20.000Z info hetang-ops: route-compare {"routingMode":"shadow","latencyMs":92,"rawText":"义乌店日报呢","frontDoorDecision":"legacy_pass","legacyRoute":"meta:guidance_missing_scope","semanticRoute":"query:query","legacyCapabilityId":null,"selectedCapabilityId":"store_day_summary_v1"}',
    ]);

    const result = runScript(["--log-file", logPath, "--json", "--diff-samples", "2"]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      total: 3,
      routeDiffCount: 2,
      diffSamples: [
        expect.objectContaining({
          rawText: "迎宾店这几天怎么样",
          legacyRoute: "query:query",
          semanticRoute: "analysis:analysis",
          selectedCapabilityId: "store_review_async_v1",
          latencyMs: 88,
        }),
        expect.objectContaining({
          rawText: "义乌店日报呢",
          legacyRoute: "meta:guidance_missing_scope",
          semanticRoute: "query:query",
          selectedCapabilityId: "store_day_summary_v1",
          latencyMs: 92,
        }),
      ],
    });
  });
});
