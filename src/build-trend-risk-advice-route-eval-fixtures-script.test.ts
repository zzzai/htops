import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(repoRoot, "scripts/build-trend-risk-advice-route-eval-fixtures.ts");

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) {
      continue;
    }
    await fs.rm(dir, { recursive: true, force: true });
  }
});

async function writeConfig(): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "trend-risk-advice-route-eval-script-"));
  tempDirs.push(tempDir);

  const configPath = path.join(tempDir, "htops.json");
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

  return configPath;
}

function runScript(args: string[], env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, ["--import", "tsx", scriptPath, ...args], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
  });
}

describe("build-trend-risk-advice-route-eval-fixtures script", () => {
  it("builds fixture drafts from the checked-in trend/risk/advice user utterance samples", async () => {
    const configPath = await writeConfig();

    const result = runScript(["--config", configPath], process.env);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "trend-risk-advice-store-trend-revenue-window",
          rawText: "义乌店近30天营收趋势",
          expectedLane: "query",
          expectedIntentKind: "query",
          expectedAction: "trend",
          expectedOrgIds: ["627150985244677"],
          expectedCapabilityId: "store_trend_v1",
        }),
      ]),
    );
  });
});
