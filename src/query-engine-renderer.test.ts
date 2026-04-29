import { describe, expect, it } from "vitest";

import type { QueryAnalysisLens } from "./analysis-lens.js";
import { renderRiskAdviceText } from "./query-engine-renderer.js";
import type { HetangQueryIntent } from "./query-intent.js";
import type { DailyStoreMetrics } from "./types.js";

function buildAnalysis(frameworkId: QueryAnalysisLens["framework_id"]): QueryAnalysisLens {
  const isGrowth = frameworkId === "store_growth_diagnosis_v1";
  return {
    mode: "executive_analysis",
    persona_id: isGrowth ? "growth_exec_cgo_cmo_v1" : "operations_exec_coo_v1",
    persona_label: "测试角色",
    role_mission: "测试使命",
    framework_id: frameworkId,
    output_contract_id: isGrowth ? "store_growth_brief_v2" : "store_operations_brief_v1",
    audience: "store",
    priority_dimensions: isGrowth
      ? ["retention", "member_asset_health", "unit_economics", "conversion"]
      : ["execution_efficiency", "service_conversion", "capacity_utilization", "staffing_health"],
    signal_order: [],
    section_labels: {
      summary: "增长结论",
      signals: "这家店先看什么",
      actions: "店长今天先做什么",
      ranking: "结论",
    },
    reasoning_principles: [],
    forbidden_claims: [],
  };
}

function buildIntent(): HetangQueryIntent {
  return {
    rawText: "迎宾店近7天重点看什么",
    kind: "advice",
    explicitOrgIds: ["1001"],
    allStoresRequested: false,
    timeFrame: {
      kind: "range",
      label: "近7天",
      startBizDate: "2026-04-12",
      endBizDate: "2026-04-18",
      days: 7,
    },
    metrics: [],
    unsupportedMetrics: [],
    mentionsCompareKeyword: false,
    mentionsRankingKeyword: false,
    mentionsTrendKeyword: false,
    mentionsAnomalyKeyword: false,
    mentionsRiskKeyword: true,
    mentionsAdviceKeyword: true,
    mentionsReportKeyword: false,
    semanticSlots: {
      store: {
        scope: "single",
        orgIds: ["1001"],
      },
      object: "store",
      action: "advice",
      metricKeys: [],
      time: {
        kind: "range",
        startBizDate: "2026-04-12",
        endBizDate: "2026-04-18",
        label: "近7天",
        days: 7,
      },
    },
  };
}

function buildMetrics(): DailyStoreMetrics {
  return {
    serviceRevenue: 2000,
    serviceOrderCount: 18,
    customerCount: 18,
    averageTicket: 180,
    memberRepurchaseRate7d: 0.28,
    memberRepurchaseBaseCustomerCount7d: 40,
    memberRepurchaseReturnedCustomerCount7d: 11,
    sleepingMemberRate: 0.19,
    renewalPressureIndex30d: 1.32,
    currentStoredBalance: 48000,
    storedBalanceLifeMonths: 2.4,
    addClockRate: 0.18,
    groupbuy7dRevisitRate: 0.12,
    groupbuy7dStoredValueConversionRate: 0.05,
  } as DailyStoreMetrics;
}

describe("query-engine-renderer environment context", () => {
  it("adds a seasonal explanation hint when environment context is present", () => {
    const text = renderRiskAdviceText({
      summary: {
        orgId: "1001",
        storeName: "迎宾店",
        frame: {
          kind: "range",
          label: "近7天",
          startBizDate: "2026-04-12",
          endBizDate: "2026-04-18",
          days: 7,
        },
        reports: [],
        metrics: buildMetrics(),
        complete: true,
      } as never,
      intent: buildIntent(),
      analysis: buildAnalysis("store_growth_diagnosis_v1"),
      environmentContext: {
        bizDate: "2026-04-18",
        seasonTag: "spring",
        solarTerm: "guyu",
        postDinnerLeisureBias: "high",
        eveningOutingLikelihood: "high",
        badWeatherTouchPenalty: "none",
      },
    });

    expect(text).toContain("春季晚间出行偏活跃");
    expect(text).toContain("谷雨");
  });

  it("keeps the environment explanation hidden when narrative policy is suppress", () => {
    const text = renderRiskAdviceText({
      summary: {
        orgId: "1001",
        storeName: "迎宾店",
        frame: {
          kind: "range",
          label: "近7天",
          startBizDate: "2026-04-12",
          endBizDate: "2026-04-18",
          days: 7,
        },
        reports: [],
        metrics: buildMetrics(),
        complete: true,
      } as never,
      intent: buildIntent(),
      analysis: buildAnalysis("store_growth_diagnosis_v1"),
      environmentContext: {
        bizDate: "2026-04-18",
        seasonTag: "spring",
        solarTerm: "guyu",
        postDinnerLeisureBias: "high",
        eveningOutingLikelihood: "high",
        badWeatherTouchPenalty: "none",
        narrativePolicy: "suppress",
      },
    });

    expect(text).not.toContain("春季晚间出行偏活跃");
    expect(text).not.toContain("谷雨");
  });

  it("adds an external context hint when store external context is present", () => {
    const text = renderRiskAdviceText({
      summary: {
        orgId: "1001",
        storeName: "迎宾店",
        frame: {
          kind: "range",
          label: "近7天",
          startBizDate: "2026-04-12",
          endBizDate: "2026-04-18",
          days: 7,
        },
        reports: [],
        metrics: buildMetrics(),
        complete: true,
      } as never,
      intent: buildIntent(),
      analysis: buildAnalysis("store_growth_diagnosis_v1"),
      storeExternalContext: {
        orgId: "1001",
        snapshotDate: "2026-04-18",
        confirmed: {
          service_hours: "11:30-次日02:00",
        },
        estimatedMarketContext: {
          market_population_scale_3km: 449600,
          hotel_poi_count_3km: 477,
        },
        researchNotes: [
          {
            metricKey: "store_business_scene_inference",
            value: "大店 + 晚场 + 多人局 + 商务/社区混合型",
            note: "仅用于策略解释",
            confidence: "medium",
            sourceType: "composite_research_judgement",
            sourceLabel: "综合研判",
            applicableModules: ["store_advice"],
            notForScoring: true,
            updatedAt: "2026-04-18T10:04:00.000Z",
          },
        ],
        provenance: {
          confirmed: {
            service_hours: {
              truthLevel: "confirmed",
              confidence: "high",
              sourceType: "store_page_screenshot",
              sourceLabel: "门店页截图",
              applicableModules: ["store_advice"],
              notForScoring: false,
              updatedAt: "2026-04-18T10:00:00.000Z",
            },
          },
          estimatedMarketContext: {
            market_population_scale_3km: {
              truthLevel: "estimated",
              confidence: "medium",
              sourceType: "third_party_pdf",
              sourceLabel: "查周边.pdf",
              applicableModules: ["store_advice"],
              notForScoring: true,
              updatedAt: "2026-04-18T10:01:00.000Z",
            },
            hotel_poi_count_3km: {
              truthLevel: "estimated",
              confidence: "medium",
              sourceType: "third_party_pdf",
              sourceLabel: "查周边.pdf",
              applicableModules: ["store_advice"],
              notForScoring: true,
              updatedAt: "2026-04-18T10:01:00.000Z",
            },
          },
        },
      },
    } as never);

    expect(text).toContain("外部情报补充");
    expect(text).toContain("11:30-次日02:00");
    expect(text).toContain("44.96万人");
    expect(text).toContain("大店 + 晚场");
  });

  it("keeps diagnosis text unchanged when environment context is absent", () => {
    const text = renderRiskAdviceText({
      summary: {
        orgId: "1001",
        storeName: "迎宾店",
        frame: {
          kind: "range",
          label: "近7天",
          startBizDate: "2026-04-12",
          endBizDate: "2026-04-18",
          days: 7,
        },
        reports: [],
        metrics: buildMetrics(),
        complete: true,
      } as never,
      intent: buildIntent(),
      analysis: buildAnalysis("store_growth_diagnosis_v1"),
    });

    expect(text).not.toContain("春季晚间出行偏活跃");
    expect(text).not.toContain("今天天气");
  });

  it("appends a world-model supplement when bounded simulation text is provided", () => {
    const text = renderRiskAdviceText({
      summary: {
        orgId: "1001",
        storeName: "迎宾店",
        frame: {
          kind: "range",
          label: "近7天",
          startBizDate: "2026-04-12",
          endBizDate: "2026-04-18",
          days: 7,
        },
        reports: [],
        metrics: buildMetrics(),
        complete: true,
      } as never,
      intent: buildIntent(),
      analysis: buildAnalysis("store_growth_diagnosis_v1"),
      worldModelSupplement:
        "世界模型补充判断：当前更适合优先补晚饭后与夜场承接，把已有需求先接稳，再决定是否继续放量。\n当前世界模型主要依据：环境上下文、外部情报；仍待补齐：门店经营事实、会员/反馈样本、行业观察。仅作辅助参考，后续会继续补数完善。",
    } as never);

    expect(text).toContain("世界模型补充判断");
    expect(text).toContain("后续会继续补数完善");
  });
});
