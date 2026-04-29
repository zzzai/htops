import { describe, expect, it } from "vitest";
import { resolveHetangOpsConfig } from "./config.js";
import {
  buildHqPortfolioRouteEvalFixtures,
  type HqPortfolioUtteranceSample,
} from "./hq-portfolio-route-eval-fixture-builder.js";
import samples from "./hq-portfolio-utterance-samples.json" with { type: "json" };

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

describe("buildHqPortfolioRouteEvalFixtures", () => {
  it("builds stable route-eval fixtures from the checked-in HQ portfolio sample library", () => {
    const fixtures = buildHqPortfolioRouteEvalFixtures({
      config: buildConfig(),
      now: new Date("2026-04-17T10:00:00+08:00"),
      samples: samples.slice(0, 3) as HqPortfolioUtteranceSample[],
    });

    expect(fixtures).toEqual([
      {
        id: "hq-portfolio-hq-portfolio-priority-open",
        rawText: "哪个门店须重点关注",
        expectedLane: "query",
        expectedIntentKind: "query",
        expectedAction: "ranking",
        expectedCapabilityId: "hq_window_ranking_v1",
        notes: "总部优先级 / 重点关注门店",
      },
      {
        id: "hq-portfolio-hq-portfolio-risk-open",
        rawText: "哪个店风险最大",
        expectedLane: "query",
        expectedIntentKind: "query",
        expectedAction: "ranking",
        expectedCapabilityId: "hq_window_ranking_v1",
        notes: "风险排序 / 风险最大门店",
      },
      {
        id: "hq-portfolio-hq-portfolio-overview-open",
        rawText: "各店整体情况，总部重点关注哪家",
        expectedLane: "query",
        expectedIntentKind: "query",
        expectedAction: "ranking",
        expectedCapabilityId: "hq_window_ranking_v1",
        notes: "总部全景 / 总部重点关注",
      },
    ]);
  });
});
