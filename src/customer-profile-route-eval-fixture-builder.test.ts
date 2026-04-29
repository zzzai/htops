import { describe, expect, it } from "vitest";
import { resolveHetangOpsConfig } from "./config.js";
import {
  buildCustomerProfileRouteEvalFixtures,
  type CustomerProfileUtteranceSample,
} from "./customer-profile-route-eval-fixture-builder.js";
import samples from "./customer-profile-utterance-samples.json" with { type: "json" };

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

describe("buildCustomerProfileRouteEvalFixtures", () => {
  it("builds stable route-eval fixtures from the checked-in customer profile sample library", () => {
    const fixtures = buildCustomerProfileRouteEvalFixtures({
      config: buildConfig(),
      now: new Date("2026-04-15T10:00:00+08:00"),
      samples: samples.slice(0, 3) as CustomerProfileUtteranceSample[],
    });

    expect(fixtures).toEqual([
      {
        id: "customer-profile-customer-profile-phone-suffix-basic",
        rawText: "义乌店尾号7500客户画像",
        expectedLane: "query",
        expectedIntentKind: "query",
        expectedAction: "profile",
        expectedOrgIds: ["627150985244677"],
        expectedCapabilityId: "customer_profile_lookup_v1",
        notes: "顾客画像 / 尾号基础画像",
      },
      {
        id: "customer-profile-customer-profile-phone-suffix-window",
        rawText: "义乌店近30天尾号7500客户画像",
        expectedLane: "query",
        expectedIntentKind: "query",
        expectedAction: "profile",
        expectedOrgIds: ["627150985244677"],
        expectedCapabilityId: "customer_profile_lookup_v1",
        notes: "顾客画像 / 近30天尾号画像",
      },
      {
        id: "customer-profile-customer-profile-phone-suffix-wording",
        rawText: "义乌店手机尾号7500的客户画像",
        expectedLane: "query",
        expectedIntentKind: "query",
        expectedAction: "profile",
        expectedOrgIds: ["627150985244677"],
        expectedCapabilityId: "customer_profile_lookup_v1",
        notes: "顾客画像 / 手机尾号画像",
      },
    ]);
  });
});
