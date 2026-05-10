import { describe, expect, it, vi } from "vitest";
import { resolveHetangOpsConfig } from "./config.js";
import { resolveHetangQueryEntry } from "./query-entry-adapter.js";
import type { HetangEmployeeBinding } from "./types.js";

function buildConfig() {
  return resolveHetangOpsConfig({
    api: {
      appKey: "demo-app-key",
      appSecret: "demo-app-secret",
    },
    database: {
      url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
    },
    stores: [
      { orgId: "1001", storeName: "义乌店", rawAliases: ["义乌"] },
      { orgId: "1002", storeName: "迎宾店", rawAliases: ["迎宾"] },
    ],
  });
}

const YIWU_MANAGER_BINDING: HetangEmployeeBinding = {
  channel: "wecom",
  senderId: "manager-yiwu",
  employeeName: "义乌店长",
  role: "manager",
  isActive: true,
  scopeOrgIds: ["1001"],
};

const HQ_BINDING: HetangEmployeeBinding = {
  channel: "wecom",
  senderId: "hq-1",
  employeeName: "总部甲",
  role: "hq",
  isActive: true,
};

describe("resolveHetangQueryEntry answerability gate", () => {
  const config = buildConfig();
  const now = new Date("2026-04-13T09:00:00+08:00");

  it("stops profit asks before execution when the cost model contract is missing", async () => {
    await expect(
      resolveHetangQueryEntry({
        runtime: {},
        config,
        binding: YIWU_MANAGER_BINDING,
        text: "义乌店3月可分配现金利润多少",
        now,
      }),
    ).resolves.toEqual({
      kind: "clarify",
      source: "rule_clarifier",
      reason: "answerability-contract-gap",
      failureClass: "missing_cost_model_contract",
      text: "当前还没接入门店运营成本口径，暂时不能严肃计算利润 / 可分配现金利润。现在可以先问现金业绩、劳动业绩、实收劳动业绩。",
    });
  });

  it("stops supported questions before execution when the data coverage gate reports gaps", async () => {
    const assessDataCoverage = vi.fn().mockResolvedValue({
      complete: false,
      coverageRate: 0.57,
      missingFacts: ["daily_store_metrics"],
      missingRanges: [
        {
          orgId: "1001",
          startBizDate: "2026-04-07",
          endBizDate: "2026-04-09",
        },
      ],
      reason: "mart_daily_store_metrics_incomplete",
    });

    await expect(
      resolveHetangQueryEntry({
        runtime: { assessDataCoverage },
        config,
        binding: YIWU_MANAGER_BINDING,
        text: "义乌店近7天客流",
        now,
      }),
    ).resolves.toEqual({
      kind: "clarify",
      source: "rule_clarifier",
      reason: "answerability-data-gap",
      failureClass: "mart_daily_store_metrics_incomplete",
      text: "当前数据覆盖不完整，暂时不能严肃回答这个时间范围的问题。缺失数据：daily_store_metrics；缺口范围：1001 2026-04-07 至 2026-04-09。",
    });
    expect(assessDataCoverage).toHaveBeenCalledWith(
      expect.objectContaining({
        orgIds: ["1001"],
        metrics: ["customerCount"],
        requiredFacts: ["daily_store_metrics"],
      }),
    );
  });

  it("returns a deterministic boundary reply for external research asks", async () => {
    await expect(
      resolveHetangQueryEntry({
        runtime: {},
        config,
        binding: YIWU_MANAGER_BINDING,
        text: "帮我做长风拨筋这个品牌的竞品分析",
        now,
      }),
    ).resolves.toEqual({
      kind: "clarify",
      source: "rule_clarifier",
      reason: "unsupported-external-research",
      failureClass: "unsupported_external_research",
      text: "当前这套门店语义层主要回答门店经营数据、规则口径和受控经营分析。品牌 / 竞品 / 行业研究要走 HQ 外部情报 / 外部研究 lane，不能直接当作门店经营查询来答。",
    });
  });

  it("uses semantic fallback for a natural-language diagnostic ask without explicit business keywords", async () => {
    const resolveSemanticFallbackIntent = vi.fn().mockResolvedValue({
      clarificationText: "这句话能看出你想排查问题，但还缺门店范围，请先说具体门店或直接问五店全景。",
    });

    await expect(
      resolveHetangQueryEntry({
        runtime: { resolveSemanticFallbackIntent },
        config,
        binding: YIWU_MANAGER_BINDING,
        text: "这几天感觉不太对，帮我看下",
        now,
      }),
    ).resolves.toEqual({
      kind: "clarify",
      source: "ai_fallback",
      reason: "supported-unresolved-query",
      text: "这句话能看出你想排查问题，但还缺门店范围，请先说具体门店或直接问五店全景。",
    });
    expect(resolveSemanticFallbackIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "这几天感觉不太对，帮我看下",
      }),
    );
  });

  it("still runs the answerability gate on fallback-intent results", async () => {
    const resolveSemanticFallbackIntent = vi.fn().mockResolvedValue({
      intent: {
        rawText: "这几天感觉不太对，帮我看下",
        kind: "metric",
        explicitOrgIds: [],
        allStoresRequested: false,
        timeFrame: {
          kind: "single",
          bizDate: "2026-04-13",
          label: "今天",
          days: 1,
        },
        metrics: [{ key: "serviceRevenue", label: "服务营收" }],
        unsupportedMetrics: [],
        mentionsCompareKeyword: false,
        mentionsRankingKeyword: false,
        mentionsTrendKeyword: false,
        mentionsAnomalyKeyword: false,
        mentionsRiskKeyword: false,
        mentionsAdviceKeyword: false,
        mentionsReportKeyword: false,
        routeConfidence: "medium",
        semanticSlots: {
          store: {
            scope: "implicit",
            orgIds: [],
          },
          object: "store",
          action: "metric",
          metricKeys: ["serviceRevenue"],
          time: {
            kind: "single",
            startBizDate: "2026-04-13",
            endBizDate: "2026-04-13",
            label: "今天",
            days: 1,
          },
        },
      },
    });

    await expect(
      resolveHetangQueryEntry({
        runtime: { resolveSemanticFallbackIntent },
        config,
        binding: HQ_BINDING,
        text: "这几天感觉不太对，帮我看下",
        now,
      }),
    ).resolves.toEqual({
      kind: "clarify",
      source: "ai_fallback",
      reason: "answerability-missing-store",
      failureClass: "missing_store",
      text: "这个问题还缺少必要条件，请补充门店、时间或指标后再查。",
    });
  });
});
