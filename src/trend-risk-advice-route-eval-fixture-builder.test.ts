import { describe, expect, it } from "vitest";
import { resolveHetangOpsConfig } from "./config.js";
import {
  buildTrendRiskAdviceRouteEvalFixtures,
  type TrendRiskAdviceUtteranceSample,
} from "./trend-risk-advice-route-eval-fixture-builder.js";
import samples from "./trend-risk-advice-utterance-samples.json" with { type: "json" };

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

describe("buildTrendRiskAdviceRouteEvalFixtures", () => {
  it("builds stable route-eval fixtures from the checked-in trend/risk/advice sample library", () => {
    const fixtures = buildTrendRiskAdviceRouteEvalFixtures({
      config: buildConfig(),
      now: new Date("2026-04-15T10:00:00+08:00"),
      samples: samples.slice(0, 4) as TrendRiskAdviceUtteranceSample[],
    });

    expect(fixtures).toEqual([
      {
        id: "trend-risk-advice-store-trend-revenue-window",
        rawText: "义乌店近30天营收趋势",
        expectedLane: "query",
        expectedIntentKind: "query",
        expectedAction: "trend",
        expectedOrgIds: ["627150985244677"],
        expectedCapabilityId: "store_trend_v1",
        notes: "趋势分析 / 营收趋势",
      },
      {
        id: "trend-risk-advice-store-trend-revenue-rise-fall-window",
        rawText: "义乌店近30天营收是涨还是掉",
        expectedLane: "query",
        expectedIntentKind: "query",
        expectedAction: "trend",
        expectedOrgIds: ["627150985244677"],
        expectedCapabilityId: "store_trend_v1",
        notes: "趋势分析 / 营收涨跌口语趋势",
      },
      {
        id: "trend-risk-advice-store-trend-softening-window",
        rawText: "义乌店近30天营收走弱了吗",
        expectedLane: "query",
        expectedIntentKind: "query",
        expectedAction: "trend",
        expectedOrgIds: ["627150985244677"],
        expectedCapabilityId: "store_trend_v1",
        notes: "趋势分析 / 走弱回落口语趋势",
      },
      {
        id: "trend-risk-advice-store-trend-strengthening-window",
        rawText: "义乌店近30天营收回暖了吗",
        expectedLane: "query",
        expectedIntentKind: "query",
        expectedAction: "trend",
        expectedOrgIds: ["627150985244677"],
        expectedCapabilityId: "store_trend_v1",
        notes: "趋势分析 / 回暖拉升口语趋势",
      },
    ]);
  });
});
