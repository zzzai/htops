import { describe, expect, it } from "vitest";
import { resolveHetangOpsConfig } from "./config.js";
import { resolveSemanticIntent } from "./semantic-intent.js";
import samples from "./customer-profile-utterance-samples.json" with { type: "json" };

type CustomerProfileUtteranceSample = {
  id: string;
  category: string;
  action: "profile";
  label: string;
  primary: string;
  similars: string[];
  expectedCapabilityId: string;
  expectedOrgIds?: string[];
};

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

describe("customer-profile-utterance-samples", () => {
  const typed = samples as CustomerProfileUtteranceSample[];
  const config = buildConfig();
  const now = new Date("2026-04-14T10:00:00+08:00");

  it("covers stable phone-suffix customer profile asks with unique ids and paraphrases", () => {
    expect(typed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "customer-profile-phone-suffix-basic",
          action: "profile",
        }),
        expect.objectContaining({
          id: "customer-profile-phone-suffix-window",
          action: "profile",
        }),
      ]),
    );

    expect(new Set(typed.map((sample) => sample.id)).size).toBe(typed.length);
  });

  it.each(typed)("routes $id primary and similars to customer profile lookup", (sample) => {
    expect(sample.category).not.toHaveLength(0);
    expect(sample.label).not.toHaveLength(0);
    expect(sample.primary).not.toHaveLength(0);
    expect(sample.similars.length).toBeGreaterThan(0);
    expect(sample.expectedCapabilityId).toBe("customer_profile_lookup_v1");

    for (const utterance of [sample.primary, ...sample.similars]) {
      const intent = resolveSemanticIntent({ config, text: utterance, now });
      expect(intent.lane, utterance).toBe("query");
      expect(intent.kind, utterance).toBe("query");
      expect(intent.action, utterance).toBe("profile");
      expect(intent.capabilityId, utterance).toBe("customer_profile_lookup_v1");
    }

    if (sample.expectedOrgIds && sample.expectedOrgIds.length > 0) {
      const intent = resolveSemanticIntent({ config, text: sample.primary, now });
      expect(intent.scope.orgIds).toEqual(sample.expectedOrgIds);
    }
  });
});
