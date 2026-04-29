import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(repoRoot, "scripts/export-phase1b-eval-set.ts");

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
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "phase1b-eval-set-script-"));
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
      {
        requestId: "req-2",
        channel: "wecom",
        senderId: "user-2",
        senderName: "王运营",
        conversationId: "conv-2",
        isGroup: true,
        wasMentioned: false,
        content: "义乌店昨天营收多少",
        effectiveContent: "义乌店昨天营收多少",
        receivedAt: "2026-04-15T09:12:00+08:00",
      },
      {
        requestId: "req-3",
        channel: "wecom",
        senderId: "user-3",
        senderName: "张总",
        conversationId: "conv-3",
        isGroup: false,
        content: "义乌店昨天营收多少",
        effectiveContent: "义乌店昨天营收多少",
        receivedAt: "2026-04-15T09:15:00+08:00",
      },
      {
        requestId: "req-4",
        channel: "wecom",
        senderId: "user-4",
        senderName: "张总",
        conversationId: "conv-4",
        isGroup: false,
        content: "义乌店近5天日报",
        effectiveContent: "义乌店近5天日报",
        receivedAt: "2026-04-15T09:20:00+08:00",
      },
    ]),
    "utf8",
  );

  return { configPath, inputPath };
}

function runScript(args: string[], env: NodeJS.ProcessEnv = process.env) {
  return spawnSync(process.execPath, ["--import", "tsx", scriptPath, ...args], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
  });
}

describe("export-phase1b-eval-set script", () => {
  it("builds a deduplicated eval set from inbound audits and excludes unmentioned group chatter by default", async () => {
    const { configPath, inputPath } = await writeFixtureInputs();

    const result = runScript(["--input", inputPath, "--config", configPath, "--limit", "10"]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      sourceAuditCount: 4,
      includedAuditCount: 2,
      fixtureCount: 2,
      fixtures: [
        expect.objectContaining({
          rawText: "义乌店昨天营收多少",
          expectedLane: "query",
        }),
        expect.objectContaining({
          rawText: "义乌店近5天日报",
        }),
      ],
    });
  });
});
