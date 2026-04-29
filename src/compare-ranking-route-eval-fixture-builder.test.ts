import { describe, expect, it } from "vitest";
import { resolveHetangOpsConfig } from "./config.js";
import {
  buildCompareRankingRouteEvalFixtures,
  type CompareRankingUtteranceSample,
} from "./compare-ranking-route-eval-fixture-builder.js";
import samples from "./compare-ranking-utterance-samples.json" with { type: "json" };

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

describe("buildCompareRankingRouteEvalFixtures", () => {
  it("builds stable route-eval fixtures from the checked-in compare/ranking sample library", () => {
    const fixtures = buildCompareRankingRouteEvalFixtures({
      config: buildConfig(),
      now: new Date("2026-04-14T10:00:00+08:00"),
      samples: samples.slice(0, 3) as CompareRankingUtteranceSample[],
    });

    expect(fixtures).toEqual([
      {
        id: "compare-ranking-store-compare-peer-revenue-day",
        rawText: "义乌店和园中园店昨天营收对比",
        expectedLane: "query",
        expectedIntentKind: "query",
        expectedAction: "compare",
        expectedOrgIds: ["627150985244677", "627153074147333"],
        expectedCapabilityId: "store_compare_lookup_v1",
        notes: "compare/ranking / 跨店对比 / 跨店单日营收对比",
      },
      {
        id: "compare-ranking-store-compare-peer-customer-day",
        rawText: "义乌店和迎宾店昨日客流对比",
        expectedLane: "query",
        expectedIntentKind: "query",
        expectedAction: "compare",
        expectedOrgIds: ["627150985244677", "627149864218629"],
        expectedCapabilityId: "store_compare_lookup_v1",
        notes: "compare/ranking / 跨店对比 / 跨店单日客流对比",
      },
      {
        id: "compare-ranking-store-compare-period-revenue-window",
        rawText: "义乌店本周和上周营收对比",
        expectedLane: "query",
        expectedIntentKind: "query",
        expectedAction: "compare",
        expectedOrgIds: ["627150985244677"],
        expectedCapabilityId: "store_compare_lookup_v1",
        notes: "compare/ranking / 跨期对比 / 单店跨周营收对比",
      },
    ]);
  });
});
