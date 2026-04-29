import { describe, expect, it } from "vitest";
import { resolveHetangOpsConfig } from "./config.js";
import {
  buildSpecializedQueryRouteEvalFixtures,
  type SpecializedQueryUtteranceSample,
} from "./specialized-query-route-eval-fixture-builder.js";
import samples from "./specialized-query-utterance-samples.json" with { type: "json" };

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

describe("buildSpecializedQueryRouteEvalFixtures", () => {
  it("builds stable route-eval fixtures from the checked-in specialized query sample library", () => {
    const fixtures = buildSpecializedQueryRouteEvalFixtures({
      config: buildConfig(),
      now: new Date("2026-04-15T10:00:00+08:00"),
      samples: (samples as SpecializedQueryUtteranceSample[]).slice(0, 4),
    });

    expect(fixtures).toEqual([
      {
        id: "specialized-query-store-report-day",
        rawText: "义乌店昨天日报",
        expectedLane: "query",
        expectedIntentKind: "query",
        expectedAction: "report",
        expectedOrgIds: ["627150985244677"],
        expectedCapabilityId: "store_report_v1",
        notes: "门店报告 / 单店日报",
      },
      {
        id: "specialized-query-birthday-member-list-day",
        rawText: "义乌店明天过生日的会员有哪些",
        expectedLane: "query",
        expectedIntentKind: "query",
        expectedAction: "list",
        expectedOrgIds: ["627150985244677"],
        expectedCapabilityId: "birthday_member_list_v1",
        notes: "名单查询 / 生日会员名单",
      },
      {
        id: "specialized-query-customer-ranked-list-vip",
        rawText: "义乌店高价值会员名单",
        expectedLane: "query",
        expectedIntentKind: "query",
        expectedAction: "list",
        expectedOrgIds: ["627150985244677"],
        expectedCapabilityId: "customer_ranked_list_lookup_v1",
        notes: "名单查询 / 高价值会员名单",
      },
      {
        id: "specialized-query-tech-profile-basic",
        rawText: "义乌店技师白慧慧画像",
        expectedLane: "query",
        expectedIntentKind: "query",
        expectedAction: "profile",
        expectedOrgIds: ["627150985244677"],
        expectedCapabilityId: "tech_profile_lookup_v1",
        notes: "技师画像 / 技师画像查询",
      },
    ]);
  });
});
