import { describe, expect, it } from "vitest";
import { getStoreByOrgId, hasHetangApiCredentials, resolveHetangOpsConfig } from "./config.js";

function buildRawConfig(overrides: Record<string, unknown> = {}) {
  return {
    api: {
      appKey: "demo-app-key",
      appSecret: "demo-app-secret",
    },
    database: {
      url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
    },
    stores: [
      {
        orgId: "1001",
        storeName: "一号店",
        rawAliases: ["1店", "一店"],
        notification: { channel: "wecom", target: "store-1001" },
      },
      {
        orgId: "1002",
        storeName: "二号店",
        rawAliases: ["2店"],
        notification: { channel: "wecom", target: "store-1002" },
      },
      {
        orgId: "1003",
        storeName: "三号店",
        rawAliases: ["3店"],
        notification: { channel: "wecom", target: "store-1003" },
      },
      {
        orgId: "1004",
        storeName: "四号店",
        rawAliases: ["4店"],
        notification: { channel: "wecom", target: "store-1004" },
      },
      {
        orgId: "1005",
        storeName: "五号店",
        rawAliases: ["5店"],
        notification: { channel: "wecom", target: "store-1005" },
      },
    ],
    ...overrides,
  };
}

describe("resolveHetangOpsConfig", () => {
  it("parses the fixed five-store mapping and exposes canonical lookup by org id", () => {
    const config = resolveHetangOpsConfig(buildRawConfig());

    expect(config.stores).toHaveLength(5);
    expect(config.api.baseUrl).toContain("/api/thirdparty");
    expect(config.database.url).toContain("postgresql://");
    expect(config.sync.initialBackfillDays).toBe(90);
    expect(config.sync.overlapDays).toBe(7);
    expect(config.sync.runAtLocalTime).toBe("03:10");
    expect(config.sync.accessWindowStartLocalTime).toBe("03:00");
    expect(config.sync.accessWindowEndLocalTime).toBe("18:00");
    expect(config.sync.businessDayCutoffLocalTime).toBe("03:00");
    expect(config.sync.historyCatchupAtLocalTime).toBe("04:05");
    expect(config.sync.historyBackfillEnabled).toBe(true);
    expect(config.sync.historyBackfillDays).toBe(180);
    expect(config.sync.historyBackfillSliceDays).toBe(7);
    expect(config.timeZone).toBe("Asia/Shanghai");
    expect(config.reporting.middayBriefAtLocalTime).toBe("12:00");
    expect(config.reporting.fiveStoreDailyOverviewAtLocalTime).toBe("09:05");
    expect(config.reporting.reactivationPushAtLocalTime).toBe("15:00");
    expect(config.reporting.sendReportEnabled).toBe(true);
    expect(config.reporting.sendFiveStoreDailyOverviewEnabled).toBe(true);
    expect(config.reporting.weeklyChartAtLocalTime).toBe("09:18");
    expect(config.reporting.monthlyReportAtLocalTime).toBe("09:25");
    expect(config.reporting.sendMiddayBriefEnabled).toBe(true);
    expect(config.reporting.sendReactivationPushEnabled).toBe(true);
    expect(config.reporting.sendWeeklyChartEnabled).toBe(true);
    expect(config.reporting.sendMonthlyReportEnabled).toBe(true);
    expect(config.service.enableInGateway).toBe(true);
    expect(config.service.scheduledPollIntervalMs).toBe(60_000);
    expect(config.service.analysisPollIntervalMs).toBe(10_000);
    expect(config.queue.maxPendingAnalysisJobsPerOrg).toBe(20);
    expect(config.queue.deadLetterEnabled).toBe(true);
    expect(config.database.queryPoolMax).toBe(8);
    expect(config.database.syncPoolMax).toBe(4);
    expect(config.database.analysisPoolMax).toBe(4);
    expect(getStoreByOrgId(config, "1003")).toMatchObject({
      orgId: "1003",
      storeName: "三号店",
      rawAliases: ["3店"],
    });
  });

  it("allows API configs that only declare the documented app secret", () => {
    const config = resolveHetangOpsConfig(
      buildRawConfig({
        api: {
          appSecret: "doc-fixed-secret",
        },
      }),
    );

    expect(config.api.appKey).toBeUndefined();
    expect(config.api.appSecret).toBe("doc-fixed-secret");
  });

  it("supports enabling midday briefs while disabling daily report delivery", () => {
    const config = resolveHetangOpsConfig(
      buildRawConfig({
        reporting: {
          enabled: true,
          sendReportEnabled: false,
          sendMiddayBriefEnabled: true,
          middayBriefAtLocalTime: "12:00",
        },
      }),
    );

    expect(config.reporting.enabled).toBe(true);
    expect(config.reporting.sendReportEnabled).toBe(false);
    expect(config.reporting.sendMiddayBriefEnabled).toBe(true);
    expect(config.reporting.middayBriefAtLocalTime).toBe("12:00");
  });

  it("lets weekly chart delivery inherit a safe delay after the weekly report unless explicitly overridden", () => {
    const inherited = resolveHetangOpsConfig(
      buildRawConfig({
        reporting: {
          enabled: true,
          weeklyReportAtLocalTime: "10:05",
        },
      }),
    );
    const overridden = resolveHetangOpsConfig(
      buildRawConfig({
        reporting: {
          enabled: true,
          weeklyReportAtLocalTime: "10:05",
          weeklyChartAtLocalTime: "10:12",
          sendWeeklyChartEnabled: false,
        },
      }),
    );

    expect(inherited.reporting.weeklyChartAtLocalTime).toBe("10:08");
    expect(inherited.reporting.sendWeeklyChartEnabled).toBe(true);
    expect(overridden.reporting.weeklyChartAtLocalTime).toBe("10:12");
    expect(overridden.reporting.sendWeeklyChartEnabled).toBe(false);
  });

  it("lets five-store daily overview delivery inherit a safe delay after daily reports unless explicitly overridden", () => {
    const inherited = resolveHetangOpsConfig(
      buildRawConfig({
        reporting: {
          enabled: true,
          sendAtLocalTime: "10:00",
        },
      }),
    );
    const overridden = resolveHetangOpsConfig(
      buildRawConfig({
        reporting: {
          enabled: true,
          sendAtLocalTime: "10:00",
          fiveStoreDailyOverviewAtLocalTime: "10:12",
          sendFiveStoreDailyOverviewEnabled: false,
        },
      }),
    );

    expect(inherited.reporting.fiveStoreDailyOverviewAtLocalTime).toBe("10:05");
    expect(inherited.reporting.sendFiveStoreDailyOverviewEnabled).toBe(true);
    expect(overridden.reporting.fiveStoreDailyOverviewAtLocalTime).toBe("10:12");
    expect(overridden.reporting.sendFiveStoreDailyOverviewEnabled).toBe(false);
  });

  it("parses optional weekly delivery start dates for safe rollout gating", () => {
    const config = resolveHetangOpsConfig(
      buildRawConfig({
        reporting: {
          enabled: true,
          weeklyReportStartDate: "2026-04-27",
          weeklyChartStartDate: "2026-04-27",
        },
      }),
    );

    expect(config.reporting.weeklyReportStartDate).toBe("2026-04-27");
    expect(config.reporting.weeklyChartStartDate).toBe("2026-04-27");
  });

  it("parses optional monthly delivery start month for safe rollout gating", () => {
    const config = resolveHetangOpsConfig(
      buildRawConfig({
        reporting: {
          enabled: true,
          monthlyReportAtLocalTime: "10:25",
          monthlyReportStartMonth: "2026-05",
          sendMonthlyReportEnabled: false,
        },
      }),
    );

    expect(config.reporting.monthlyReportAtLocalTime).toBe("10:25");
    expect(config.reporting.monthlyReportStartMonth).toBe("2026-05");
    expect(config.reporting.sendMonthlyReportEnabled).toBe(false);
  });

  it("keeps semantic fallback off by default until explicitly configured", () => {
    const config = resolveHetangOpsConfig(buildRawConfig());

    expect(config.semanticFallback.enabled).toBe(false);
    expect(config.semanticFallback.baseUrl).toBeUndefined();
    expect(config.semanticFallback.apiKey).toBeUndefined();
    expect(config.semanticFallback.model).toBeUndefined();
    expect(config.semanticFallback.timeoutMs).toBe(5_000);
    expect(config.semanticFallback.autoAcceptConfidence).toBe(0.85);
    expect(config.semanticFallback.clarifyConfidence).toBe(0.7);
    expect(config.conversationQuality).toEqual({
      intentClarifier: {
        enabled: true,
        maxQuestionsPerTurn: 1,
      },
      replyGuard: {
        enabled: true,
        allowOneRepairAttempt: true,
      },
      correctionInterrupt: {
        enabled: true,
        recentTurnTtlMs: 180000,
      },
    });
  });

  it("parses semantic fallback config and resolves env-backed credentials", () => {
    const envName = "HETANG_OPS_TEST_SEMANTIC_KEY";
    const previous = process.env[envName];
    process.env[envName] = "semantic-secret";

    try {
      const config = resolveHetangOpsConfig(
        buildRawConfig({
          semanticFallback: {
            enabled: true,
            baseUrl: "https://semantic.example.com/v1",
            apiKey: `\${${envName}}`,
            model: "gpt-4.1-mini",
            timeoutMs: 3200,
            autoAcceptConfidence: 0.9,
            clarifyConfidence: 0.72,
          },
        }),
      );

      expect(config.semanticFallback).toEqual({
        enabled: true,
        baseUrl: "https://semantic.example.com/v1",
        apiKey: "semantic-secret",
        model: "gpt-4.1-mini",
        timeoutMs: 3200,
        autoAcceptConfidence: 0.9,
        clarifyConfidence: 0.72,
      });
    } finally {
      if (previous === undefined) {
        delete process.env[envName];
      } else {
        process.env[envName] = previous;
      }
    }
  });

  it("parses top-level ai lane config independently from legacy semantic fallback and customer growth ai", () => {
    const config = resolveHetangOpsConfig(
      buildRawConfig({
        aiLanes: {
          "general-lite": {
            model: "deepseek-v3-2-251201",
            reasoningMode: "off",
            timeoutMs: 2500,
            responseMode: "text",
            fallbackBehavior: "legacy",
          },
          "analysis-premium": {
            model: "gpt-5.4",
            reasoningMode: "high",
            timeoutMs: 90000,
            responseMode: "json",
            fallbackBehavior: "deterministic",
          },
        },
      }),
    );

    expect(config.aiLanes).toEqual({
      "general-lite": {
        model: "deepseek-v3-2-251201",
        reasoningMode: "off",
        timeoutMs: 2500,
        responseMode: "text",
        fallbackBehavior: "legacy",
      },
      "analysis-premium": {
        model: "gpt-5.4",
        reasoningMode: "high",
        timeoutMs: 90000,
        responseMode: "json",
        fallbackBehavior: "deterministic",
      },
    });
    expect(config.semanticFallback.enabled).toBe(false);
    expect(config.customerGrowthAi.enabled).toBe(false);
  });

  it("keeps ai lanes empty by default so legacy callers still load", () => {
    const config = resolveHetangOpsConfig(buildRawConfig());

    expect(config.aiLanes).toEqual({});
    expect(config.semanticFallback.enabled).toBe(false);
    expect(config.customerGrowthAi.enabled).toBe(false);
  });

  it("resolves env-backed ai lane credentials and fallback lanes", () => {
    const envName = "HETANG_OPS_TEST_AI_LANE_KEY";
    const previous = process.env[envName];
    process.env[envName] = "lane-secret";

    try {
      const config = resolveHetangOpsConfig(
        buildRawConfig({
          aiLanes: {
            "customer-growth-json": {
              baseUrl: "https://customer-growth.example.com/v1",
              apiKey: `\${${envName}}`,
              model: "deepseek-v3-2-251201",
              timeoutMs: 4200,
              responseMode: "json",
              fallbackBehavior: "lane",
              fallbackLaneId: "cheap-summary",
            },
          },
        }),
      );

      expect(config.aiLanes["customer-growth-json"]).toEqual({
        baseUrl: "https://customer-growth.example.com/v1",
        apiKey: "lane-secret",
        model: "deepseek-v3-2-251201",
        timeoutMs: 4200,
        responseMode: "json",
        fallbackBehavior: "lane",
        fallbackLaneId: "cheap-summary",
      });
    } finally {
      if (previous === undefined) {
        delete process.env[envName];
      } else {
        process.env[envName] = previous;
      }
    }
  });

  it("accepts reserved future ai lane ids without activating current execution paths", () => {
    const config = resolveHetangOpsConfig(
      buildRawConfig({
        aiLanes: {
          "hq-premium": {
            model: "gpt-5.4",
            reasoningMode: "high",
            timeoutMs: 120000,
            responseMode: "json",
            fallbackBehavior: "deterministic",
          },
          "world-model-explanation": {
            model: "gpt-5.4",
            reasoningMode: "high",
            timeoutMs: 120000,
            responseMode: "json",
            fallbackBehavior: "deterministic",
          },
          "doctor-review": {
            model: "gpt-5.4",
            reasoningMode: "high",
            timeoutMs: 120000,
            responseMode: "json",
            fallbackBehavior: "deterministic",
          },
        },
      }),
    );

    expect(config.aiLanes["hq-premium"]).toEqual({
      model: "gpt-5.4",
      reasoningMode: "high",
      timeoutMs: 120000,
      responseMode: "json",
      fallbackBehavior: "deterministic",
    });
    expect(config.aiLanes["world-model-explanation"]).toEqual({
      model: "gpt-5.4",
      reasoningMode: "high",
      timeoutMs: 120000,
      responseMode: "json",
      fallbackBehavior: "deterministic",
    });
    expect(config.aiLanes["doctor-review"]).toEqual({
      model: "gpt-5.4",
      reasoningMode: "high",
      timeoutMs: 120000,
      responseMode: "json",
      fallbackBehavior: "deterministic",
    });
  });

  it("keeps customer growth ai off by default until explicitly configured", () => {
    const config = resolveHetangOpsConfig(buildRawConfig());

    expect(config.customerGrowthAi).toEqual({
      enabled: false,
      baseUrl: undefined,
      apiKey: undefined,
      model: undefined,
      timeoutMs: 5_000,
      profileInsight: { enabled: false },
      tagAdvisor: { enabled: false },
      strategyAdvisor: { enabled: false },
      followupSummarizer: { enabled: false },
    });
  });

  it("keeps xiaohongshu inbound link reader off by default until explicitly configured", () => {
    const config = resolveHetangOpsConfig(buildRawConfig());

    expect(config.inboundLinkReaders.xiaohongshu).toEqual({
      enabled: false,
      autocliBin: undefined,
      timeoutMs: 45_000,
      browserTimeoutMs: 45_000,
      acceptText: "收到，正在读取。",
      maxContentChars: 1200,
    });
  });

  it("parses xiaohongshu inbound link reader config independently from customer growth ai", () => {
    const config = resolveHetangOpsConfig(
      buildRawConfig({
        inboundLinkReaders: {
          xiaohongshu: {
            enabled: true,
            autocliBin: "/opt/autocli/bin/autocli",
            timeoutMs: 52_000,
            browserTimeoutMs: 61_000,
            acceptText: "收到，正在读取。",
            maxContentChars: 1800,
          },
        },
      }),
    );

    expect(config.inboundLinkReaders.xiaohongshu).toEqual({
      enabled: true,
      autocliBin: "/opt/autocli/bin/autocli",
      timeoutMs: 52_000,
      browserTimeoutMs: 61_000,
      acceptText: "收到，正在读取。",
      maxContentChars: 1800,
    });
  });

  it("parses customer growth ai config independently from semantic fallback", () => {
    const config = resolveHetangOpsConfig(
      buildRawConfig({
        customerGrowthAi: {
          enabled: true,
          baseUrl: "https://customer-growth.example.com/v1",
          apiKey: "growth-secret",
          model: "gpt-5-mini",
          timeoutMs: 4200,
          profileInsight: { enabled: true },
          tagAdvisor: { enabled: true },
          strategyAdvisor: { enabled: true },
          followupSummarizer: { enabled: false },
        },
      }),
    );

    expect(config.customerGrowthAi).toEqual({
      enabled: true,
      baseUrl: "https://customer-growth.example.com/v1",
      apiKey: "growth-secret",
      model: "gpt-5-mini",
      timeoutMs: 4200,
      profileInsight: { enabled: true },
      tagAdvisor: { enabled: true },
      strategyAdvisor: { enabled: true },
      followupSummarizer: { enabled: false },
    });
  });

  it("parses a shared reporting delivery target for scheduled group pushes", () => {
    const config = resolveHetangOpsConfig(
      buildRawConfig({
        reporting: {
          enabled: true,
          sharedDelivery: {
            channel: "wecom",
            target: "REPLACE_WITH_SHARED_DELIVERY_TARGET",
            enabled: true,
          },
          sendReportEnabled: false,
          sendMiddayBriefEnabled: true,
          sendReactivationPushEnabled: true,
        },
      }),
    );

    expect(config.reporting.sharedDelivery).toEqual({
      channel: "wecom",
      target: "REPLACE_WITH_SHARED_DELIVERY_TARGET",
      enabled: true,
      accountId: undefined,
      threadId: undefined,
    });
    expect(config.reporting.sendReportEnabled).toBe(false);
    expect(config.reporting.sendMiddayBriefEnabled).toBe(true);
    expect(config.reporting.sendReactivationPushEnabled).toBe(true);
  });

  it("parses store-level customer growth primary segment tuning", () => {
    const config = resolveHetangOpsConfig(
      buildRawConfig({
        stores: [
          {
            orgId: "1001",
            storeName: "一号店",
            rawAliases: ["1店", "一店"],
            customerGrowth: {
              primarySegmentThresholds: {
                highValueMemberVisitCount90d: 5,
                highValueMemberPayAmount90d: 1600,
                highValueMemberActiveMaxSilentDays: 21,
                potentialGrowthPayAmount90d: 680,
                potentialGrowthMaxVisitCount90d: 3,
              },
            },
          },
        ],
      }),
    );

    expect(config.stores[0]?.customerGrowth).toEqual({
      primarySegmentThresholds: {
        highValueMemberVisitCount90d: 5,
        highValueMemberPayAmount90d: 1600,
        highValueMemberActiveMaxSilentDays: 21,
        potentialGrowthPayAmount90d: 680,
        potentialGrowthMaxVisitCount90d: 3,
      },
    });
  });

  it("parses store-level reactivation capacity tuning", () => {
    const config = resolveHetangOpsConfig(
      buildRawConfig({
        stores: [
          {
            orgId: "1001",
            storeName: "一号店",
            rawAliases: ["1店", "一店"],
            customerGrowth: {
              reactivationCapacity: {
                dailyTouchCapacity: 12,
              },
            },
          },
        ],
      }),
    );

    expect(config.stores[0]?.customerGrowth).toEqual({
      primarySegmentThresholds: undefined,
      reactivationCapacity: {
        dailyTouchCapacity: 12,
      },
    });
  });

  it("allows missing API secret so database-backed commands can still load", () => {
    const config = resolveHetangOpsConfig(
      buildRawConfig({
        api: {},
      }),
    );

    expect(config.api.appSecret).toBeUndefined();
  });

  it("treats unresolved env-backed API credentials as unavailable instead of crashing", () => {
    const secretEnvName = "HETANG_OPS_TEST_MISSING_APP_SECRET";
    const keyEnvName = "HETANG_OPS_TEST_MISSING_APP_KEY";
    const previousSecret = process.env[secretEnvName];
    const previousKey = process.env[keyEnvName];
    delete process.env[secretEnvName];
    delete process.env[keyEnvName];

    try {
      const config = resolveHetangOpsConfig(
        buildRawConfig({
          api: {
            appKey: `\${${keyEnvName}}`,
            appSecret: `\${${secretEnvName}}`,
          },
        }),
      );

      expect(config.api.appKey).toBeUndefined();
      expect(config.api.appSecret).toBeUndefined();
      expect(hasHetangApiCredentials(config)).toBe(false);
    } finally {
      if (previousSecret === undefined) {
        delete process.env[secretEnvName];
      } else {
        process.env[secretEnvName] = previousSecret;
      }
      if (previousKey === undefined) {
        delete process.env[keyEnvName];
      } else {
        process.env[keyEnvName] = previousKey;
      }
    }
  });

  it("rejects duplicate org ids so store ownership cannot drift", () => {
    expect(() =>
      resolveHetangOpsConfig(
        buildRawConfig({
          stores: [
            {
              orgId: "1001",
              storeName: "一号店",
              notification: { channel: "wecom", target: "store-1001" },
            },
            {
              orgId: "1001",
              storeName: "二号店",
              notification: { channel: "wecom", target: "store-1002" },
            },
            {
              orgId: "1003",
              storeName: "三号店",
              notification: { channel: "wecom", target: "store-1003" },
            },
            {
              orgId: "1004",
              storeName: "四号店",
              notification: { channel: "wecom", target: "store-1004" },
            },
            {
              orgId: "1005",
              storeName: "五号店",
              notification: { channel: "wecom", target: "store-1005" },
            },
          ],
        }),
      ),
    ).toThrow(/duplicate orgid/i);
  });

  it("requires at least one configured store", () => {
    expect(() =>
      resolveHetangOpsConfig(
        buildRawConfig({
          stores: [],
        }),
      ),
    ).toThrow(/at least one store/i);
  });

  it("allows an access-only bootstrap with fewer stores when sync and reporting are both disabled", () => {
    const config = resolveHetangOpsConfig(
      buildRawConfig({
        sync: { enabled: false },
        reporting: { enabled: false },
        stores: [
          {
            orgId: "627150985244677",
            storeName: "荷塘悦色义乌店",
            rawAliases: ["义乌店"],
          },
        ],
      }),
    );

    expect(config.stores).toHaveLength(1);
    expect(config.sync.enabled).toBe(false);
    expect(config.reporting.enabled).toBe(false);
    expect(config.stores[0]).toMatchObject({
      orgId: "627150985244677",
      storeName: "荷塘悦色义乌店",
    });
  });

  it("requires a PostgreSQL connection url", () => {
    expect(() =>
      resolveHetangOpsConfig({
        ...buildRawConfig(),
        database: {},
      }),
    ).toThrow(/database.url/i);
  });

  it("defaults the external intelligence config with daily brief composition targets", () => {
    const config = resolveHetangOpsConfig(
      buildRawConfig({
        externalIntelligence: {},
      }),
    );

    expect(config.externalIntelligence.enabled).toBe(false);
    expect(config.externalIntelligence.freshnessHours).toBe(72);
    expect(config.externalIntelligence.maxItemsPerIssue).toBe(10);
    expect(config.externalIntelligence.briefComposition).toMatchObject({
      generalHotTopic: 4,
      chainBrand: 3,
      strategyPlatform: 3,
    });
    expect(config.externalIntelligence.hqDelivery).toEqual({
      channel: "wecom",
      target: "hetang-hq-intel",
    });
  });

  it("supports tiered external sources and HQ delivery overrides", () => {
    const config = resolveHetangOpsConfig(
      buildRawConfig({
        externalIntelligence: {
          enabled: true,
          freshnessHours: 24,
          briefComposition: {
            generalHotTopic: 5,
            chainBrand: 4,
            strategyPlatform: 2,
          },
          maxItemsPerIssue: 11,
          hqDelivery: {
            channel: "wechat",
            target: "hetang-intel-brief",
          },
          sources: [
            { sourceId: "tier-s", displayName: "Tier S Source", tier: "s" },
            { sourceId: "tier-a", displayName: "Tier A Source", tier: "a" },
            { sourceId: "tier-b", displayName: "Tier B Source", tier: "b" },
            { sourceId: "tier-blocked", displayName: "Blocked Source", tier: "blocked" },
          ],
        },
      }),
    );

    expect(config.externalIntelligence.enabled).toBe(true);
    expect(config.externalIntelligence.freshnessHours).toBe(24);
    expect(config.externalIntelligence.hqDelivery).toEqual({
      channel: "wechat",
      target: "hetang-intel-brief",
    });
    expect(config.externalIntelligence.sources.map((source) => source.tier)).toEqual([
      "s",
      "a",
      "b",
      "blocked",
    ]);
    expect(config.externalIntelligence.briefComposition).toMatchObject({
      generalHotTopic: 5,
      chainBrand: 4,
      strategyPlatform: 2,
    });
  });

  it("preserves default brief composition counts when only a single override is provided", () => {
    const config = resolveHetangOpsConfig(
      buildRawConfig({
        externalIntelligence: {
          briefComposition: {
            chainBrand: 2,
          },
        },
      }),
    );

    expect(config.externalIntelligence.briefComposition).toEqual({
      generalHotTopic: 4,
      chainBrand: 2,
      strategyPlatform: 3,
    });
  });

  it("rejects brief composition counts that are not positive integers", () => {
    expect(() =>
      resolveHetangOpsConfig(
        buildRawConfig({
          externalIntelligence: {
            briefComposition: {
              generalHotTopic: 0,
            },
          },
        }),
      ),
    ).toThrow(/generalhottopic.*positive integer/i);
  });

  it("requires maxItemsPerIssue to cover the brief composition totals", () => {
    expect(() =>
      resolveHetangOpsConfig(
        buildRawConfig({
          externalIntelligence: {
            briefComposition: {
              generalHotTopic: 4,
              chainBrand: 3,
              strategyPlatform: 3,
            },
            maxItemsPerIssue: 9,
          },
        }),
      ),
    ).toThrow(/maxitem(s)?perissue.*sum/i);
  });

  it("rejects unknown external source tiers", () => {
    expect(() =>
      resolveHetangOpsConfig(
        buildRawConfig({
          externalIntelligence: {
            sources: [{ sourceId: "bad-tier", tier: "z" }],
          },
        }),
      ),
    ).toThrow(/tier/i);
  });
});
