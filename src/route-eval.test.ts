import { describe, expect, it } from "vitest";
import {
  buildCompareRankingRouteEvalFixtures,
  type CompareRankingUtteranceSample,
} from "./compare-ranking-route-eval-fixture-builder.js";
import compareRankingSamples from "./compare-ranking-utterance-samples.json" with { type: "json" };
import { resolveHetangOpsConfig } from "./config.js";
import {
  buildCustomerProfileRouteEvalFixtures,
  type CustomerProfileUtteranceSample,
} from "./customer-profile-route-eval-fixture-builder.js";
import customerProfileSamples from "./customer-profile-utterance-samples.json" with { type: "json" };
import {
  buildHqPortfolioRouteEvalFixtures,
  type HqPortfolioUtteranceSample,
} from "./hq-portfolio-route-eval-fixture-builder.js";
import hqPortfolioSamples from "./hq-portfolio-utterance-samples.json" with { type: "json" };
import {
  buildBoundMetricRouteEvalFixtures,
  buildMetricRouteEvalFixtures,
} from "./metric-route-eval-fixture-builder.js";
import metricSamples from "./metric-user-utterance-samples.json" with { type: "json" };
import { resolveSemanticIntent } from "./semantic-intent.js";
import {
  buildSpecializedQueryRouteEvalFixtures,
  type SpecializedQueryUtteranceSample,
} from "./specialized-query-route-eval-fixture-builder.js";
import specializedQuerySamples from "./specialized-query-utterance-samples.json" with { type: "json" };
import {
  buildTrendRiskAdviceRouteEvalFixtures,
  type TrendRiskAdviceUtteranceSample,
} from "./trend-risk-advice-route-eval-fixture-builder.js";
import trendRiskAdviceSamples from "./trend-risk-advice-utterance-samples.json" with { type: "json" };
import fixtures from "./route-eval-fixtures.json" with { type: "json" };

type EvalFixture = {
  id: string;
  rawText: string;
  expectedLane: "meta" | "query" | "analysis";
  expectedIntentKind: string;
  expectedAction?: string;
  expectedOrgIds?: string[];
  expectedCapabilityId?: string;
  notes?: string;
  bindingRequired?: string;
  allowAlternateKinds?: string[];
  allowAlternateLanes?: ("meta" | "query" | "analysis")[];
};

const config = resolveHetangOpsConfig({
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

const now = new Date("2026-04-14T10:00:00+08:00");
const specializedQuerySampleLibrary =
  specializedQuerySamples as SpecializedQueryUtteranceSample[];

const singleStoreBinding = {
  channel: "wecom" as const,
  senderId: "eval-manager",
  employeeName: "迎宾店店长",
  role: "manager" as const,
  orgId: "627149864218629",
  scopeOrgIds: ["627149864218629"],
  isActive: true,
};

function assertFixture(
  fixture: EvalFixture,
  intent: ReturnType<typeof resolveSemanticIntent>,
): void {
  if (fixture.allowAlternateLanes && fixture.allowAlternateLanes.length > 0) {
    expect([fixture.expectedLane, ...fixture.allowAlternateLanes]).toContain(intent.lane);
  } else {
    expect(intent.lane).toBe(fixture.expectedLane);
  }

  if (fixture.allowAlternateKinds && fixture.allowAlternateKinds.length > 0) {
    expect([fixture.expectedIntentKind, ...fixture.allowAlternateKinds]).toContain(intent.kind);
  } else {
    expect(intent.kind).toBe(fixture.expectedIntentKind);
  }

  if (fixture.expectedOrgIds && fixture.expectedOrgIds.length > 0) {
    for (const expectedOrgId of fixture.expectedOrgIds) {
      expect(intent.scope.orgIds).toContain(expectedOrgId);
    }
  }

  if (fixture.expectedCapabilityId) {
    expect(intent.capabilityId).toBe(fixture.expectedCapabilityId);
  }

  if (fixture.expectedAction) {
    expect(intent.action).toBe(fixture.expectedAction);
  }
}

describe("route eval fixtures", () => {
  const typed = [
    ...(fixtures as EvalFixture[]),
    ...(buildMetricRouteEvalFixtures({
      config,
      now,
      samples: metricSamples,
    }) as EvalFixture[]),
    ...(buildBoundMetricRouteEvalFixtures({
      config,
      now,
      binding: singleStoreBinding,
      samples: metricSamples,
    }) as EvalFixture[]),
    ...(buildCompareRankingRouteEvalFixtures({
      config,
      now,
      samples: compareRankingSamples as CompareRankingUtteranceSample[],
    }) as EvalFixture[]),
    ...(buildCustomerProfileRouteEvalFixtures({
      config,
      now,
      samples: customerProfileSamples as CustomerProfileUtteranceSample[],
    }) as EvalFixture[]),
    ...(buildHqPortfolioRouteEvalFixtures({
      config,
      now,
      samples: hqPortfolioSamples as HqPortfolioUtteranceSample[],
    }) as EvalFixture[]),
    ...(buildSpecializedQueryRouteEvalFixtures({
      config,
      now,
      samples: specializedQuerySampleLibrary,
    }) as EvalFixture[]),
    ...(buildTrendRiskAdviceRouteEvalFixtures({
      config,
      now,
      samples: trendRiskAdviceSamples as TrendRiskAdviceUtteranceSample[],
    }) as EvalFixture[]),
  ];

  const noBindingFixtures = typed.filter((f) => !f.bindingRequired);
  for (const fixture of noBindingFixtures) {
    it(`[${fixture.id}] ${fixture.rawText.slice(0, 40)}`, () => {
      const intent = resolveSemanticIntent({ config, text: fixture.rawText, now });
      assertFixture(fixture, intent);
    });
  }

  const bindingFixtures = typed.filter((f) => f.bindingRequired === "single-store");
  for (const fixture of bindingFixtures) {
    it(`[${fixture.id}] (bound) ${fixture.rawText.slice(0, 40)}`, () => {
      const intent = resolveSemanticIntent({
        config,
        text: fixture.rawText,
        now,
        binding: singleStoreBinding,
        defaultOrgId: singleStoreBinding.orgId,
      });
      assertFixture(fixture, intent);
    });
  }
});
