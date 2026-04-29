import { describe, expect, it } from "vitest";
import { resolveHetangOpsConfig } from "./config.js";
import { resolveSemanticIntent } from "./semantic-intent.js";
import samples from "./hq-portfolio-utterance-samples.json" with { type: "json" };

type HqPortfolioUtteranceSample = {
  id: string;
  category: string;
  label: string;
  primary: string;
  similars: string[];
  expectedCapabilityId: string;
  expectedTimeFrameLabel?: string;
  expectedTimeFrameLabels?: string[];
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

describe("hq-portfolio-utterance-samples", () => {
  const typed = samples as HqPortfolioUtteranceSample[];
  const config = buildConfig();
  const now = new Date("2026-04-17T10:00:00+08:00");

  it("covers stable HQ portfolio asks with unique ids and paraphrases", () => {
    expect(typed.map((sample) => sample.id)).toEqual([
      "hq-portfolio-priority-open",
      "hq-portfolio-risk-open",
      "hq-portfolio-overview-open",
      "hq-portfolio-overview-window",
      "hq-portfolio-drag-open",
      "hq-portfolio-drag-window",
      "hq-portfolio-metric-worst-window",
      "hq-portfolio-metric-lowest-window",
      "hq-portfolio-rise-risk-open",
      "hq-portfolio-rescue-window",
      "hq-portfolio-diagnosis-window",
    ]);

    expect(new Set(typed.map((sample) => sample.id)).size).toBe(typed.length);
  });

  it.each(typed)(
    "routes $id primary and similars to query:ranking on the HQ portfolio capability",
    (sample) => {
      expect(sample.category).not.toHaveLength(0);
      expect(sample.label).not.toHaveLength(0);
      expect(sample.primary).not.toHaveLength(0);
      expect(sample.similars.length).toBeGreaterThan(0);

      for (const utterance of [sample.primary, ...sample.similars]) {
        const intent = resolveSemanticIntent({ config, text: utterance, now });
        expect(intent.lane, utterance).toBe("query");
        expect(intent.kind, utterance).toBe("query");
        expect(intent.object, utterance).toBe("hq");
        expect(intent.action, utterance).toBe("ranking");
        expect(intent.scope.allStores, utterance).toBe(true);
        expect(intent.capabilityId, utterance).toBe(sample.expectedCapabilityId);
        const expectedLabels = sample.expectedTimeFrameLabels ?? [sample.expectedTimeFrameLabel];
        expect(expectedLabels.filter(Boolean), utterance).toContain(intent.timeFrameLabel);
      }
    },
  );
});
