import { describe, expect, it } from "vitest";

import type {
  CustomerOperatingProfileDailyRecord,
  EnvironmentContextSnapshot,
  HetangStoreExternalContextEntry,
} from "../types.js";
import {
  buildWeeklyReportWorldModelLines,
  renderStoreAdviceWorldModelSupplement,
} from "./rendering.js";

function buildExternalEntry(
  overrides: Partial<HetangStoreExternalContextEntry>,
): HetangStoreExternalContextEntry {
  return {
    orgId: "1001",
    snapshotDate: "2026-04-21",
    contextKind: "estimated_market_context",
    metricKey: "competitor_count_3km",
    valueText: "8",
    valueNum: 8,
    valueJson: undefined,
    unit: "count",
    truthLevel: "estimated",
    confidence: "medium",
    sourceType: "third_party_pdf",
    sourceLabel: "查周边.pdf",
    sourceUri: "mdshuju/查周边.pdf",
    applicableModules: ["store_advice"],
    notForScoring: true,
    note: undefined,
    rawJson: "{}",
    updatedAt: "2026-04-21T08:00:00.000Z",
    ...overrides,
  };
}

function buildOperatingProfile(
  overrides: Partial<CustomerOperatingProfileDailyRecord>,
): CustomerOperatingProfileDailyRecord {
  return {
    orgId: "1001",
    bizDate: "2026-04-21",
    memberId: "M-001",
    customerIdentityKey: "member:M-001",
    customerDisplayName: "王女士",
    identityProfileJson: {},
    spendingProfileJson: {},
    serviceNeedProfileJson: {
      primary_need: "肩颈放松",
      signal_confidence: "high",
      truth_boundary: "hard_fact",
      confidence_discount: 0.05,
    },
    interactionProfileJson: {},
    preferenceProfileJson: {
      preferred_daypart: "夜场",
    },
    scenarioProfileJson: {},
    relationshipProfileJson: {},
    opportunityProfileJson: {},
    sourceSignalIds: ["sig-1"],
    updatedAt: "2026-04-21T10:00:00.000Z",
    ...overrides,
  };
}

describe("world-model rendering", () => {
  it("counts operating profile evidence as customer feedback coverage", () => {
    const text = renderStoreAdviceWorldModelSupplement({
      orgId: "1001",
      bizDate: "2026-04-21",
      environmentContext: {
        orgId: "1001",
        bizDate: "2026-04-21",
        seasonTag: "spring",
        solarTerm: "guyu",
        eveningOutingLikelihood: "high",
        postDinnerLeisureBias: "high",
        contextJson: "{}",
      } satisfies EnvironmentContextSnapshot,
      customerOperatingProfiles: [buildOperatingProfile({})],
    });

    expect(text).toContain("当前世界模型主要依据：环境上下文、会员/反馈样本");
    expect(text).toContain("仍待补齐：门店经营事实、外部情报、行业观察");
  });


  it("renders a cautious store-advice supplement from partial world-model inputs", () => {
    const text = renderStoreAdviceWorldModelSupplement({
      orgId: "1001",
      bizDate: "2026-04-21",
      environmentContext: {
        orgId: "1001",
        bizDate: "2026-04-21",
        seasonTag: "spring",
        solarTerm: "guyu",
        eveningOutingLikelihood: "high",
        postDinnerLeisureBias: "high",
        contextJson: "{}",
      } satisfies EnvironmentContextSnapshot,
      externalContextEntries: [buildExternalEntry({})],
    });

    expect(text).toContain("世界模型补充判断");
    expect(text).toContain("晚饭后与夜场承接");
    expect(text).toContain("当前世界模型主要依据：环境上下文、外部情报");
    expect(text).toContain("仍待补齐：门店经营事实、会员/反馈样本、行业观察");
    expect(text).toContain("后续会继续补数完善");
  });

  it("renders weekly-report world-model lines when traffic stays stable but recharge weakens", () => {
    const lines = buildWeeklyReportWorldModelLines({
      weekEndBizDate: "2026-04-19",
      currentAggregate: {
        revenue: 386000,
        customerCount: 402,
        rechargeCash: 12800,
        addClockRate: 0.21,
        pointClockRate: 0.22,
        newMembers: 41,
      },
      previousAggregate: {
        revenue: 381000,
        customerCount: 397,
        rechargeCash: 28600,
        addClockRate: 0.22,
        pointClockRate: 0.21,
        newMembers: 40,
      },
      industryObservations: [
        {
          key: "service-consumption-split",
          summary: "服务消费正在分化，储值决策比到店决策恢复更慢。",
          sourceCategory: "industry_signal",
          truthBoundary: "weak_signal",
          updatedAt: "2026-04-19T09:00:00.000Z",
        },
      ],
    });

    const text = lines.join("\n");
    expect(text).toContain("世界模型补充");
    expect(text).toContain("客流未必先掉");
    expect(text).toContain("当前世界模型主要依据：门店经营事实、行业观察");
    expect(text).toContain("仍待补齐：环境上下文、外部情报、会员/反馈样本");
    expect(text).toContain("后续会继续补数完善");
  });

  it("renders a bounded weekly fallback when only industry observations are available", () => {
    const lines = buildWeeklyReportWorldModelLines({
      weekEndBizDate: "2026-04-19",
      currentAggregate: {
        revenue: 386000,
        customerCount: 402,
        rechargeCash: 28600,
        addClockRate: 0.21,
        pointClockRate: 0.22,
        newMembers: 41,
      },
      previousAggregate: {
        revenue: 381000,
        customerCount: 390,
        rechargeCash: 28000,
        addClockRate: 0.22,
        pointClockRate: 0.21,
        newMembers: 40,
      },
      industryObservations: [
        {
          key: "platform_rule:meituan_price_mindshare",
          summary: "平台价格心智抬升：低价敏感客决策更快，门店更需要差异化承接。",
          sourceCategory: "industry_signal",
          truthBoundary: "weak_signal",
          updatedAt: "2026-04-19T09:00:00.000Z",
        },
      ],
    });

    const text = lines.join("\n");
    expect(text).toContain("世界模型补充");
    expect(text).toContain("行业态势");
    expect(text).toContain("平台价格心智抬升");
    expect(text).toContain("当前世界模型主要依据：行业观察");
    expect(text).toContain("仅作辅助参考");
  });
});
