import { describe, expect, it } from "vitest";
import { resolveHetangOpsConfig } from "./config.js";
import {
  buildBoundMetricRouteEvalFixtures,
  buildMetricRouteEvalFixtures,
} from "./metric-route-eval-fixture-builder.js";
import samples from "./metric-user-utterance-samples.json" with { type: "json" };

function buildConfig() {
  return resolveHetangOpsConfig({
    api: {
      appKey: "eval-app-key",
      appSecret: "eval-app-secret",
    },
    database: {
      url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
    },
    stores: [
      { orgId: "627149864218629", storeName: "荷塘悦色迎宾店", rawAliases: ["迎宾店"] },
      { orgId: "627150985244677", storeName: "荷塘悦色义乌店", rawAliases: ["义乌店"] },
      { orgId: "627152412155909", storeName: "荷塘悦色华美店", rawAliases: ["华美店"] },
      { orgId: "627152677269509", storeName: "荷塘悦色锦苑店", rawAliases: ["锦苑店"] },
      { orgId: "627153074147333", storeName: "荷塘悦色园中园店", rawAliases: ["园中园店"] },
    ],
    sync: { enabled: false },
    reporting: { enabled: false },
  });
}

describe("buildMetricRouteEvalFixtures", () => {
  it("turns primary metric asks into stable query route fixtures", () => {
    const fixtures = buildMetricRouteEvalFixtures({
      config: buildConfig(),
      now: new Date("2026-04-14T10:00:00+08:00"),
      samples: samples.slice(0, 3),
    });

    expect(fixtures).toEqual([
      {
        id: "metric-serviceRevenue",
        rawText: "义乌店昨天营收多少",
        expectedLane: "query",
        expectedIntentKind: "query",
        expectedOrgIds: ["627150985244677"],
        expectedCapabilityId: "store_day_summary_v1",
        notes: "核心经营 / 服务营收",
      },
      {
        id: "metric-antiServiceRevenue",
        rawText: "义乌店昨天反结金额多少",
        expectedLane: "query",
        expectedIntentKind: "query",
        expectedOrgIds: ["627150985244677"],
        expectedCapabilityId: "store_metric_summary_v1",
        notes: "核心经营 / 反结金额",
      },
      {
        id: "metric-serviceOrderCount",
        rawText: "义乌店昨天服务单数多少",
        expectedLane: "query",
        expectedIntentKind: "query",
        expectedOrgIds: ["627150985244677"],
        expectedCapabilityId: "store_day_summary_v1",
        notes: "核心经营 / 服务单数",
      },
    ]);
  });

  it("covers every supported metric sample with a query fixture that already resolves a capability", () => {
    const fixtures = buildMetricRouteEvalFixtures({
      config: buildConfig(),
      now: new Date("2026-04-14T10:00:00+08:00"),
      samples,
    });

    expect(fixtures).toHaveLength(samples.length);
    for (const fixture of fixtures) {
      expect(fixture.expectedLane).toBe("query");
      expect(fixture.expectedIntentKind).toBe("query");
      expect(fixture.expectedOrgIds).toEqual(["627150985244677"]);
      expect(fixture.expectedCapabilityId).toBeTruthy();
    }
  });

  it("derives single-store binding fixtures by omitting the explicit store mention from the primary ask", () => {
    const fixtures = buildBoundMetricRouteEvalFixtures({
      config: buildConfig(),
      now: new Date("2026-04-14T10:00:00+08:00"),
      binding: {
        channel: "wecom",
        senderId: "eval-manager",
        employeeName: "迎宾店店长",
        role: "manager",
        orgId: "627149864218629",
        scopeOrgIds: ["627149864218629"],
        isActive: true,
      },
      samples: samples.slice(0, 3),
    });

    expect(fixtures).toEqual([
      {
        id: "metric-bound-serviceRevenue",
        rawText: "昨天营收多少",
        expectedLane: "query",
        expectedIntentKind: "query",
        expectedOrgIds: ["627149864218629"],
        expectedCapabilityId: "store_day_summary_v1",
        notes: "single-store binding / 核心经营 / 服务营收",
        bindingRequired: "single-store",
      },
      {
        id: "metric-bound-antiServiceRevenue",
        rawText: "昨天反结金额多少",
        expectedLane: "query",
        expectedIntentKind: "query",
        expectedOrgIds: ["627149864218629"],
        expectedCapabilityId: "store_metric_summary_v1",
        notes: "single-store binding / 核心经营 / 反结金额",
        bindingRequired: "single-store",
      },
      {
        id: "metric-bound-serviceOrderCount",
        rawText: "昨天服务单数多少",
        expectedLane: "query",
        expectedIntentKind: "query",
        expectedOrgIds: ["627149864218629"],
        expectedCapabilityId: "store_day_summary_v1",
        notes: "single-store binding / 核心经营 / 服务单数",
        bindingRequired: "single-store",
      },
    ]);
  });
});
