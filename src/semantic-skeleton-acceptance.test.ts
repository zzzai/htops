import { describe, expect, it, vi } from "vitest";
import { resolveHetangOpsConfig } from "./config.js";
import { resolveSemanticAnswerability } from "./semantic-answerability.js";
import { resolveHetangQueryEntry } from "./query-entry-adapter.js";
import { createHetangToolsService } from "./tools/handlers.js";
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
    sync: { enabled: false },
    reporting: { enabled: false },
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

describe("semantic skeleton acceptance", () => {
  const config = buildConfig();
  const now = new Date("2026-05-02T10:00:00+08:00");

  it("routes the main skeleton terminal states deterministically", async () => {
    await expect(
      resolveSemanticAnswerability({
        config,
        binding: YIWU_MANAGER_BINDING,
        text: "义乌店昨天营收多少",
        now,
      }),
    ).resolves.toMatchObject({
      decision: "answer",
      capabilityId: "store_day_summary_v1",
    });

    await expect(
      resolveHetangQueryEntry({
        runtime: {},
        config,
        binding: YIWU_MANAGER_BINDING,
        text: "义乌店现在有客人在等位吗",
        now,
      }),
    ).resolves.toMatchObject({
      kind: "clarify",
      reason: "unsupported-realtime-queue",
      failureClass: "unsupported_realtime_queue",
    });

    await expect(
      resolveSemanticAnswerability({
        config,
        binding: YIWU_MANAGER_BINDING,
        text: "现在几个人在上钟",
        now,
        assessDataCoverage: async () => ({
          complete: false,
          coverageRate: 0,
          missingFacts: ["current_tech_status"],
          missingRanges: [
            {
              orgId: "1001",
              startBizDate: "2026-05-01",
              endBizDate: "2026-05-01",
            },
          ],
          reason: "current_tech_status_incomplete",
        }),
      }),
    ).resolves.toMatchObject({
      decision: "data_gap",
      reason: "current_tech_status_incomplete",
      missingData: ["current_tech_status"],
    });

    await expect(
      resolveHetangQueryEntry({
        runtime: {},
        config,
        binding: YIWU_MANAGER_BINDING,
        text: "义乌店3月可分配现金利润多少",
        now,
      }),
    ).resolves.toMatchObject({
      kind: "clarify",
      reason: "answerability-contract-gap",
      failureClass: "missing_cost_model_contract",
    });

    await expect(
      resolveHetangQueryEntry({
        runtime: {},
        config,
        binding: YIWU_MANAGER_BINDING,
        text: "帮我做长风拨筋这个品牌的竞品分析",
        now,
      }),
    ).resolves.toMatchObject({
      kind: "clarify",
      reason: "unsupported-external-research",
      failureClass: "unsupported_external_research",
    });

    const tools = createHetangToolsService({
      config,
      runtime: {
        listStoreManagerDailyKpiByDateRange: vi.fn(),
        listStoreReview7dByDateRange: vi.fn(),
        listStoreSummary30dByDateRange: vi.fn(),
        listMemberReactivationQueue: vi.fn(),
        listMemberReactivationFeatures: vi.fn(),
        listMemberReactivationStrategies: vi.fn(),
        findCurrentMembersByPhoneSuffix: vi.fn(),
        listCurrentMembers: vi.fn(),
        listCustomerProfile90dByDateRange: vi.fn(),
        executeCompiledServingQuery: vi.fn().mockResolvedValue([
          { org_id: "1001", store_name: "义乌店", tech_name: "小王", state_kind: "busy" },
        ]),
      } as never,
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
      },
      now: () => now,
    });

    await expect(
      tools.handleToolCall({
        tool: "controlled_data_explorer",
        arguments: {
          surface: "serving_tech_current",
          select: ["org_id", "store_name", "tech_name", "state_kind"],
          filters: [{ field: "state_kind", op: "eq", value: "busy" }],
          limit: 10,
        },
      }),
    ).resolves.toMatchObject({
      ok: true,
      tool: "controlled_data_explorer",
      result: {
        scope: "controlled_data_explorer_v1",
        surface: "serving_tech_current",
        rowCount: 1,
      },
    });
  });
});
