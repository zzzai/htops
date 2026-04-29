import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(repoRoot, "scripts/review-customer-profile-utterance-coverage.ts");

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
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "customer-profile-coverage-script-"));
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
          orgId: "627149864218629",
          storeName: "荷塘悦色迎宾店",
          rawAliases: ["迎宾店"],
        },
        {
          orgId: "627150985244677",
          storeName: "荷塘悦色义乌店",
          rawAliases: ["义乌店"],
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
        content: "@bot 义乌店手机号后四位9799客户画像",
        effectiveContent: "义乌店手机号后四位9799客户画像",
        receivedAt: "2026-04-15T09:10:00+08:00",
      },
    ]),
    "utf8",
  );

  return { configPath, inputPath };
}

function runScript(args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", scriptPath, ...args], {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
  });
}

describe("review-customer-profile-utterance-coverage script", () => {
  it("prints uncovered customer profile paraphrases from inbound audits", async () => {
    const { configPath, inputPath } = await writeFixtureInputs();

    const result = runScript(["--input", inputPath, "--config", configPath, "--filter", "uncovered"]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([
      expect.objectContaining({
        rawText: "义乌店手机号后四位9799客户画像",
        action: "profile",
        sampleCoverage: "uncovered_paraphrase",
        capabilityId: "customer_profile_lookup_v1",
      }),
    ]);
  });
});
