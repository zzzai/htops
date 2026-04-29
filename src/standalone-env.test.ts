import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  loadStandaloneRuntimeEnv,
  loadStandaloneHetangConfigFromFile,
  resolveStandaloneConfigPath,
  resolveStandaloneRootDir,
  resolveStandaloneRuntimeEnvPath,
  resolveStandaloneStateDir,
} from "./standalone-env.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) {
      continue;
    }
    await fs.rm(dir, { recursive: true, force: true });
  }
  delete process.env.HTOPS_CONFIG_PATH;
  delete process.env.HTOPS_STATE_DIR;
  delete process.env.HETANG_RUNTIME_ENV_FILE;
  delete process.env.HETANG_MESSAGE_SEND_BIN;
  delete process.env.HETANG_GATEWAY_SERVICE_NAME;
  delete process.env.HETANG_APP_KEY;
  delete process.env.HETANG_APP_SECRET;
  delete process.env.HETANG_DATABASE_URL;
  delete process.env.HETANG_QUERY_DATABASE_URL;
  delete process.env.HETANG_SYNC_DATABASE_URL;
  delete process.env.HETANG_ANALYSIS_DATABASE_URL;
});

describe("standalone hetang environment helpers", () => {
  it("loads standalone config from htops.json", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "htops-config-"));
    tempDirs.push(tempDir);
    const configPath = path.join(tempDir, "htops.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        timeZone: "Asia/Shanghai",
        api: {
          baseUrl: "https://example.com",
          pageSize: 200,
          timeoutMs: 20_000,
          maxRetries: 3,
        },
        sync: {
          enabled: true,
          initialBackfillDays: 3,
          overlapDays: 7,
          runAtLocalTime: "03:00",
          accessWindowStartLocalTime: "03:00",
          accessWindowEndLocalTime: "18:00",
          businessDayCutoffLocalTime: "03:00",
          historyCatchupAtLocalTime: "04:05",
          historyBackfillEnabled: true,
          historyBackfillDays: 180,
          historyBackfillSliceDays: 7,
        },
        reporting: {
          enabled: true,
          buildAtLocalTime: "08:50",
          sendAtLocalTime: "09:00",
          middayBriefAtLocalTime: "12:00",
          reactivationPushAtLocalTime: "15:00",
          sendReportEnabled: false,
          sendMiddayBriefEnabled: true,
          sendReactivationPushEnabled: true,
        },
        analysis: {
          revenueDropAlertThreshold: 0.2,
          clockDropAlertThreshold: 0.2,
        },
        semanticFallback: {
          enabled: false,
          baseUrl: "https://api.openai.com/v1",
          model: "gpt-5.4",
          apiKey: "test",
          timeoutMs: 5000,
          autoAcceptConfidence: 0.85,
          clarifyConfidence: 0.7,
        },
        service: {
          enableInGateway: false,
          scheduledPollIntervalMs: 60_000,
          analysisPollIntervalMs: 10_000,
        },
        queue: {
          maxPendingAnalysisJobsPerOrg: 20,
          deadLetterEnabled: true,
        },
        database: {
          url: "postgresql://demo",
          queryPoolMax: 8,
          syncPoolMax: 4,
          analysisPoolMax: 4,
        },
        stores: [
          {
            orgId: "store-1",
            storeName: "迎宾店",
            rawAliases: ["迎宾"],
            isActive: true,
          },
        ],
        externalIntelligence: {
          enabled: false,
          freshnessHours: 72,
          maxItemsPerIssue: 10,
          briefComposition: {
            generalHotTopic: 4,
            chainBrand: 3,
            strategyPlatform: 3,
          },
          hqDelivery: {
            channel: "wecom",
            target: "hq",
          },
          sources: [],
        },
      }),
      "utf8",
    );

    const config = await loadStandaloneHetangConfigFromFile(configPath);
    expect(config.database.url).toBe("postgresql://demo");
    expect(config.stores[0]?.storeName).toBe("迎宾店");
  });

  it("resolves default standalone paths relative to the repo root and ~/.htops", () => {
    const expectedRootDir = path.resolve(import.meta.dirname, "..");

    expect(resolveStandaloneRootDir()).toBe(expectedRootDir);
    expect(resolveStandaloneConfigPath()).toBe(path.join(expectedRootDir, "htops.json"));
    expect(resolveStandaloneRuntimeEnvPath()).toBe(path.join(expectedRootDir, ".env.runtime"));
    expect(resolveStandaloneStateDir()).toBe(path.join(os.homedir(), ".htops"));
  });

  it("loads standalone runtime env file without overriding pre-existing env", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "htops-env-"));
    tempDirs.push(tempDir);
    const envPath = path.join(tempDir, ".env.runtime");
    await fs.writeFile(
      envPath,
      [
        "HETANG_MESSAGE_SEND_BIN=htops-gateway",
        "HETANG_GATEWAY_SERVICE_NAME=htops-gateway.service",
      ].join("\n"),
      "utf8",
    );

    process.env.HETANG_RUNTIME_ENV_FILE = envPath;
    process.env.HETANG_GATEWAY_SERVICE_NAME = "already-set.service";
    await loadStandaloneRuntimeEnv();

    expect(process.env.HETANG_MESSAGE_SEND_BIN).toBe("htops-gateway");
    expect(process.env.HETANG_GATEWAY_SERVICE_NAME).toBe("already-set.service");
  });

  it("overrides placeholder api and database config from runtime env", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "htops-env-override-"));
    tempDirs.push(tempDir);
    const configPath = path.join(tempDir, "htops.json");
    const envPath = path.join(tempDir, ".env.runtime");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        api: {
          appKey: "REPLACE_WITH_APP_KEY",
          appSecret: "REPLACE_WITH_APP_SECRET",
        },
        database: {
          url: "postgresql://hetang_app:REPLACE_WITH_A_24_PLUS_CHAR_PASSWORD@127.0.0.1:55432/hetang_ops",
          queryUrl:
            "postgresql://hetang_app:REPLACE_WITH_A_24_PLUS_CHAR_PASSWORD@127.0.0.1:55432/hetang_ops",
          syncUrl:
            "postgresql://hetang_app:REPLACE_WITH_A_24_PLUS_CHAR_PASSWORD@127.0.0.1:55432/hetang_ops",
          analysisUrl:
            "postgresql://hetang_app:REPLACE_WITH_A_24_PLUS_CHAR_PASSWORD@127.0.0.1:55432/hetang_ops",
        },
        stores: [
          {
            orgId: "store-1",
            storeName: "迎宾店",
          },
        ],
      }),
      "utf8",
    );
    await fs.writeFile(
      envPath,
      [
        "HETANG_APP_KEY=live-app-key",
        "HETANG_APP_SECRET=live-app-secret",
        "HETANG_DATABASE_URL=postgresql://runtime-default",
        "HETANG_QUERY_DATABASE_URL=postgresql://runtime-query",
        "HETANG_SYNC_DATABASE_URL=postgresql://runtime-sync",
        "HETANG_ANALYSIS_DATABASE_URL=postgresql://runtime-analysis",
      ].join("\n"),
      "utf8",
    );

    process.env.HETANG_RUNTIME_ENV_FILE = envPath;
    await loadStandaloneRuntimeEnv();

    const config = await loadStandaloneHetangConfigFromFile(configPath);

    expect(config.api.appKey).toBe("live-app-key");
    expect(config.api.appSecret).toBe("live-app-secret");
    expect(config.database.url).toBe("postgresql://runtime-default");
    expect(config.database.queryUrl).toBe("postgresql://runtime-query");
    expect(config.database.syncUrl).toBe("postgresql://runtime-sync");
    expect(config.database.analysisUrl).toBe("postgresql://runtime-analysis");
  });
});
