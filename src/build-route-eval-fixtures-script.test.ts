import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(repoRoot, "scripts/build-route-eval-fixtures.ts");

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) {
      continue;
    }
    await fs.rm(dir, { recursive: true, force: true });
  }
});

async function writeFixtureInputs(): Promise<{
  configPath: string;
  inputPath: string;
}> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "route-eval-script-"));
  tempDirs.push(tempDir);

  const configPath = path.join(tempDir, "htops.json");
  const inputPath = path.join(tempDir, "audits.json");

  await fs.writeFile(
    configPath,
    JSON.stringify({
      api: {
        appKey: "eval-app-key",
        appSecret: "eval-app-secret",
      },
      database: {
        url: "postgresql://demo",
      },
      stores: [
        {
          orgId: "1001",
          storeName: "义乌店",
          rawAliases: ["义乌"],
        },
      ],
      sync: { enabled: false },
      reporting: { enabled: false },
    }),
    "utf8",
  );

  await fs.writeFile(
    inputPath,
    JSON.stringify([
      {
        requestId: "req-1",
        channel: "wecom",
        senderId: "user-1",
        senderName: "李店长",
        conversationId: "conv-1",
        isGroup: true,
        wasMentioned: true,
        content: "@bot 义乌店昨天营收多少",
        effectiveContent: "义乌店昨天营收多少",
        receivedAt: "2026-04-15T09:10:00+08:00",
      },
    ]),
    "utf8",
  );

  return { configPath, inputPath };
}

function runScript(args: string[], env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, ["--import", "tsx", scriptPath, ...args], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
  });
}

describe("build-route-eval-fixtures script", () => {
  it("loads standalone config from HTOPS_CONFIG_PATH when --config is omitted", async () => {
    const { configPath, inputPath } = await writeFixtureInputs();

    const result = runScript(["--input", inputPath], {
      ...process.env,
      HTOPS_CONFIG_PATH: configPath,
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject([
      {
        rawText: "义乌店昨天营收多少",
        expectedLane: "query",
        expectedCapabilityId: "store_day_summary_v1",
        expectedOrgIds: ["1001"],
      },
    ]);
  });

  it("accepts --config to load an explicit config file", async () => {
    const { configPath, inputPath } = await writeFixtureInputs();

    const result = runScript(["--input", inputPath, "--config", configPath], process.env);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject([
      {
        rawText: "义乌店昨天营收多少",
        expectedLane: "query",
        expectedCapabilityId: "store_day_summary_v1",
        expectedOrgIds: ["1001"],
      },
    ]);
  });
});
