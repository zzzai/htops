import { describe, expect, it, vi } from "vitest";
import { resolveHetangOpsConfig } from "./config.js";
import { resolveSemanticAnswerability } from "./semantic-answerability.js";
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

const HQ_BINDING: HetangEmployeeBinding = {
  channel: "wecom",
  senderId: "hq-1",
  employeeName: "总部甲",
  role: "hq",
  isActive: true,
};

const YIWU_MANAGER_BINDING: HetangEmployeeBinding = {
  channel: "wecom",
  senderId: "manager-yiwu",
  employeeName: "义乌店长",
  role: "manager",
  isActive: true,
  scopeOrgIds: ["1001"],
};

describe("resolveSemanticAnswerability", () => {
  const config = buildConfig();
  const now = new Date("2026-04-13T09:00:00+08:00");

  it("allows a supported store metric question when capability, slots, and contract are ready", async () => {
    await expect(
      resolveSemanticAnswerability({
        config,
        binding: HQ_BINDING,
        text: "义乌店昨天营收多少",
        now,
      }),
    ).resolves.toMatchObject({
      decision: "answer",
      capabilityId: "store_day_summary_v1",
      reason: "answerable",
      plan: {
        entity: "store",
        action: "summary",
        metrics: ["serviceRevenue"],
      },
    });
  });

  it("clarifies before execution when a multi-store user omits the store slot", async () => {
    await expect(
      resolveSemanticAnswerability({
        config,
        binding: HQ_BINDING,
        text: "昨天营收多少",
        now,
      }),
    ).resolves.toMatchObject({
      decision: "clarify",
      reason: "missing_store",
      missingSlots: ["store"],
    });
  });

  it("returns contract_gap for a metric phrase whose operating contract is not defined", async () => {
    await expect(
      resolveSemanticAnswerability({
        config,
        binding: YIWU_MANAGER_BINDING,
        text: "义乌店昨天上钟率多少",
        now,
      }),
    ).resolves.toMatchObject({
      decision: "contract_gap",
      reason: "unsupported_metric_contract",
      missingContracts: ["utilizationRate"],
    });
  });

  it("blocks profit asks that require the store cost model before execution", async () => {
    await expect(
      resolveSemanticAnswerability({
        config,
        binding: YIWU_MANAGER_BINDING,
        text: "义乌店3月可分配现金利润多少",
        now,
      }),
    ).resolves.toMatchObject({
      decision: "contract_gap",
      reason: "missing_cost_model_contract",
      missingContracts: ["store_cost_model"],
    });
  });

  it("returns data_gap when the coverage gate reports an incomplete metric window", async () => {
    await expect(
      resolveSemanticAnswerability({
        config,
        binding: HQ_BINDING,
        text: "义乌店近7天客流",
        now,
        assessDataCoverage: async (request) => ({
          complete: false,
          coverageRate: 0.57,
          missingRanges: [
            {
              orgId: "1001",
              startBizDate: request.startBizDate,
              endBizDate: "2026-04-09",
            },
          ],
          missingFacts: ["daily_store_metrics"],
          reason: "mart_daily_store_metrics_incomplete",
        }),
      }),
    ).resolves.toMatchObject({
      decision: "data_gap",
      reason: "mart_daily_store_metrics_incomplete",
      missingData: ["daily_store_metrics"],
      coverage: {
        complete: false,
        coverageRate: 0.57,
      },
    });
  });

  it("checks current-tech snapshot coverage before answering realtime floor-state asks", async () => {
    const assessDataCoverage = vi.fn().mockResolvedValue({
      complete: false,
      coverageRate: 0,
      missingFacts: ["current_tech_status"],
      missingRanges: [
        {
          orgId: "1001",
          startBizDate: "2026-04-12",
          endBizDate: "2026-04-12",
        },
      ],
      reason: "current_tech_status_incomplete",
    });

    await expect(
      resolveSemanticAnswerability({
        config,
        binding: YIWU_MANAGER_BINDING,
        text: "现在几个人在上钟",
        now,
        assessDataCoverage,
      }),
    ).resolves.toMatchObject({
      decision: "data_gap",
      reason: "current_tech_status_incomplete",
      capabilityId: "tech_current_runtime_v1",
      missingData: ["current_tech_status"],
    });
    expect(assessDataCoverage).toHaveBeenCalledWith({
      orgIds: ["1001"],
      startBizDate: "2026-04-12",
      endBizDate: "2026-04-12",
      metrics: [],
      capabilityId: "tech_current_runtime_v1",
      requiredFacts: ["current_tech_status"],
    });
  });
});
