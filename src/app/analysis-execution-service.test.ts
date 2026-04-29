import { describe, expect, it, vi } from "vitest";

const { executeHetangQueryMock } = vi.hoisted(() => ({
  executeHetangQueryMock: vi.fn(),
}));

vi.mock("../query-engine.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../query-engine.js")>();
  return {
    ...actual,
    executeHetangQuery: executeHetangQueryMock,
  };
});

import { resolveHetangOpsConfig } from "../config.js";
import { resolveOperationalBizDateCompletionIso } from "../time.js";
import { HetangAnalysisExecutionService } from "./analysis-execution-service.js";

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
      { orgId: "1001", storeName: "迎宾店", isActive: true },
      { orgId: "1002", storeName: "义乌店", isActive: true },
    ],
  });
}

describe("HetangAnalysisExecutionService", () => {
  it("decorates scoped analysis jobs with a resolved store name outside runtime facade", async () => {
    const store = {
      getEmployeeBinding: vi.fn().mockResolvedValue(null),
      getStoreName: vi.fn().mockResolvedValue("迎宾店"),
    };
    const service = new HetangAnalysisExecutionService({
      config: buildConfig(),
      getStore: async () => store as never,
      queryRuntime: {} as never,
    });

    const job = await service.decorateAnalysisJob({
      jobId: "ANL-1",
      orgId: "1001",
      channel: "wecom",
      senderId: "u-1",
      rawText: "迎宾店上周经营复盘",
      timeFrameLabel: "上周",
      startBizDate: "2026-04-01",
      endBizDate: "2026-04-07",
      jobType: "store_review",
      status: "pending",
      createdAt: "2026-04-12T01:00:00.000Z",
      updatedAt: "2026-04-12T01:00:00.000Z",
      queueDisposition: "created",
    } as never);

    expect(job.storeName).toBe("迎宾店");
  });

  it("runs scoped query analysis with resolved binding and anchored operational completion time", async () => {
    executeHetangQueryMock.mockResolvedValue({
      text: "analysis ok",
      requestedOrgIds: ["1001", "1002"],
      effectiveOrgIds: ["1001", "1002"],
    });
    const store = {
      getEmployeeBinding: vi.fn().mockResolvedValue(null),
    };
    const service = new HetangAnalysisExecutionService({
      config: buildConfig(),
      getStore: async () => store as never,
      queryRuntime: {
        resolveSemanticFallbackIntent: vi.fn(),
      } as never,
    });

    const text = await service.runScopedQueryAnalysis({
      jobId: "ANL-2",
      orgId: "scope:1001,1002",
      channel: "wecom",
      senderId: "u-2",
      rawText: "两店上周经营问题在哪",
      timeFrameLabel: "上周",
      startBizDate: "2026-04-01",
      endBizDate: "2026-04-11",
      jobType: "store_review",
      status: "running",
      createdAt: "2026-04-12T01:00:00.000Z",
      updatedAt: "2026-04-12T01:00:00.000Z",
      queueDisposition: "created",
    } as never);

    expect(text).toBe("analysis ok");
    expect(executeHetangQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "两店上周经营问题在哪",
        binding: expect.objectContaining({
          role: "hq",
          scopeOrgIds: ["1001", "1002"],
        }),
        now: new Date(
          resolveOperationalBizDateCompletionIso({
            bizDate: "2026-04-11",
            timeZone: buildConfig().timeZone,
            cutoffLocalTime: buildConfig().sync.businessDayCutoffLocalTime,
          }),
        ),
      }),
    );
  });

  it("builds a compact single-store evidence pack from deterministic runtime reads", async () => {
    const store = {
      getEmployeeBinding: vi.fn().mockResolvedValue(null),
      getStoreName: vi.fn().mockResolvedValue("迎宾店"),
    };
    const service = new HetangAnalysisExecutionService({
      config: buildConfig(),
      getStore: async () => store as never,
      queryRuntime: {
        buildReport: vi.fn().mockResolvedValue({
          orgId: "1001",
          storeName: "迎宾店",
          bizDate: "2026-04-11",
          complete: true,
          alerts: [{ code: "sleeping-high", severity: "warn", message: "沉默会员偏高" }],
          suggestions: ["先拉回近7天未复购会员。"],
          metrics: {
            serviceRevenue: 3200,
            totalClockCount: 40,
            clockEffect: 80,
            pointClockRate: 0.45,
            addClockRate: 0.3,
            sleepingMemberRate: 0.16,
            currentStoredBalance: 96000,
          },
        }),
        listStoreReview7dByDateRange: vi.fn().mockResolvedValue([
          {
            orgId: "1001",
            windowEndBizDate: "2026-04-11",
            storeName: "迎宾店",
            revenue7d: 21000,
            orderCount7d: 126,
            totalClocks7d: 280,
            clockEffect7d: 75,
            averageTicket7d: 166.7,
            pointClockRate7d: 0.44,
            addClockRate7d: 0.29,
            rechargeCash7d: 5000,
            storedConsumeAmount7d: 7800,
            storedConsumeRate7d: 0.72,
            onDutyTechCount7d: 8,
            groupbuyOrderShare7d: 0.22,
            groupbuyCohortCustomerCount: 30,
            groupbuy7dRevisitCustomerCount: 10,
            groupbuy7dRevisitRate: 0.33,
            groupbuy7dCardOpenedCustomerCount: 4,
            groupbuy7dCardOpenedRate: 0.13,
            groupbuy7dStoredValueConvertedCustomerCount: 5,
            groupbuy7dStoredValueConversionRate: 0.17,
            groupbuy30dMemberPayConvertedCustomerCount: 8,
            groupbuy30dMemberPayConversionRate: 0.27,
            groupbuyFirstOrderCustomerCount: 12,
            groupbuyFirstOrderHighValueMemberCustomerCount: 2,
            groupbuyFirstOrderHighValueMemberRate: 0.17,
            effectiveMembers: 180,
            sleepingMembers: 29,
            sleepingMemberRate: 29 / 180,
            newMembers7d: 9,
            activeTechCount7d: 7,
            currentStoredBalance: 96000,
            storedBalanceLifeMonths: 3.8,
            renewalPressureIndex30d: 1.18,
            memberRepurchaseBaseCustomerCount7d: 42,
            memberRepurchaseReturnedCustomerCount7d: 16,
            memberRepurchaseRate7d: 16 / 42,
          },
        ]),
        listStoreSummary30dByDateRange: vi.fn().mockResolvedValue([
          {
            orgId: "1001",
            windowEndBizDate: "2026-04-11",
            storeName: "迎宾店",
            revenue30d: 88000,
            orderCount30d: 540,
            totalClocks30d: 1180,
            clockEffect30d: 74.6,
            averageTicket30d: 163,
            pointClockRate30d: 0.46,
            addClockRate30d: 0.31,
            rechargeCash30d: 21000,
            storedConsumeAmount30d: 32000,
            storedConsumeRate30d: 0.68,
            onDutyTechCount30d: 9,
            groupbuyOrderShare30d: 0.2,
            groupbuyCohortCustomerCount: 120,
            groupbuy7dRevisitCustomerCount: 40,
            groupbuy7dRevisitRate: 0.33,
            groupbuy7dCardOpenedCustomerCount: 18,
            groupbuy7dCardOpenedRate: 0.15,
            groupbuy7dStoredValueConvertedCustomerCount: 20,
            groupbuy7dStoredValueConversionRate: 0.17,
            groupbuy30dMemberPayConvertedCustomerCount: 36,
            groupbuy30dMemberPayConversionRate: 0.3,
            groupbuyFirstOrderCustomerCount: 48,
            groupbuyFirstOrderHighValueMemberCustomerCount: 8,
            groupbuyFirstOrderHighValueMemberRate: 1 / 6,
            effectiveMembers: 180,
            sleepingMembers: 29,
            sleepingMemberRate: 29 / 180,
            newMembers30d: 36,
            activeTechCount30d: 8,
            currentStoredBalance: 96000,
            storedBalanceLifeMonths: 3.8,
            renewalPressureIndex30d: 1.18,
            memberRepurchaseBaseCustomerCount7d: 42,
            memberRepurchaseReturnedCustomerCount7d: 16,
            memberRepurchaseRate7d: 16 / 42,
          },
        ]),
        listTechLeaderboard: vi.fn().mockResolvedValue([
          {
            personCode: "tech-1",
            personName: "技师甲",
            totalClockCount: 88,
            upClockRecordCount: 110,
            pointClockRecordCount: 70,
            pointClockRate: 70 / 110,
            addClockRecordCount: 33,
            addClockRate: 0.3,
            turnover: 12800,
            commission: 4200,
            commissionRate: 0.328,
            clockEffect: 145.5,
            marketRevenue: 600,
            marketCommission: 120,
          },
          {
            personCode: "tech-2",
            personName: "技师乙",
            totalClockCount: 66,
            upClockRecordCount: 100,
            pointClockRecordCount: 48,
            pointClockRate: 0.48,
            addClockRecordCount: 24,
            addClockRate: 0.24,
            turnover: 9800,
            commission: 3200,
            commissionRate: 0.326,
            clockEffect: 148.5,
            marketRevenue: 400,
            marketCommission: 80,
          },
        ]),
      } as never,
    });

    const pack = await service.buildAnalysisEvidencePack({
      jobId: "ANL-3",
      orgId: "1001",
      channel: "wecom",
      senderId: "u-3",
      rawText: "迎宾店上周经营复盘",
      timeFrameLabel: "上周",
      startBizDate: "2026-04-05",
      endBizDate: "2026-04-11",
      jobType: "store_review",
      status: "running",
      createdAt: "2026-04-12T01:00:00.000Z",
      updatedAt: "2026-04-12T01:00:00.000Z",
      queueDisposition: "created",
    } as never);

    expect(pack.scopeType).toBe("single_store");
    expect(pack.markdown).toContain("证据包");
    expect(pack.markdown).toContain("门店: 迎宾店");
    expect(pack.markdown).toContain("最新日报");
    expect(pack.markdown).toContain("7日复盘");
    expect(pack.markdown).toContain("30日摘要");
    expect(pack.markdown).toContain("技师样本");
    expect(pack.markdown).toContain("技师甲");
  });

  it("builds a portfolio evidence pack with stable per-store snapshots", async () => {
    const store = {
      getEmployeeBinding: vi.fn().mockResolvedValue({
        channel: "wecom",
        senderId: "hq-1",
        role: "hq",
        isActive: true,
        scopeOrgIds: ["1001", "1002"],
      }),
    };
    const service = new HetangAnalysisExecutionService({
      config: buildConfig(),
      getStore: async () => store as never,
      queryRuntime: {
        buildReport: vi.fn(async ({ orgId }) => ({
          orgId,
          storeName: orgId === "1001" ? "迎宾店" : "义乌店",
          bizDate: "2026-04-11",
          complete: true,
          alerts: [],
          suggestions: [],
          metrics: {
            serviceRevenue: orgId === "1001" ? 3200 : 2600,
            totalClockCount: orgId === "1001" ? 40 : 31,
            clockEffect: orgId === "1001" ? 80 : 68,
            sleepingMemberRate: orgId === "1001" ? 0.16 : 0.24,
          },
        })),
        listStoreReview7dByDateRange: vi.fn(async ({ orgId }) => [
          {
            orgId,
            windowEndBizDate: "2026-04-11",
            storeName: orgId === "1001" ? "迎宾店" : "义乌店",
            revenue7d: orgId === "1001" ? 21000 : 16800,
            orderCount7d: orgId === "1001" ? 126 : 101,
            totalClocks7d: orgId === "1001" ? 280 : 224,
            clockEffect7d: orgId === "1001" ? 75 : 62,
            averageTicket7d: orgId === "1001" ? 166.7 : 158.1,
            pointClockRate7d: orgId === "1001" ? 0.44 : 0.31,
            addClockRate7d: orgId === "1001" ? 0.29 : 0.08,
            rechargeCash7d: orgId === "1001" ? 5000 : 3200,
            storedConsumeAmount7d: orgId === "1001" ? 7800 : 4900,
            storedConsumeRate7d: orgId === "1001" ? 0.72 : 0.41,
            onDutyTechCount7d: orgId === "1001" ? 8 : 6,
            groupbuyOrderShare7d: 0.22,
            groupbuyCohortCustomerCount: 30,
            groupbuy7dRevisitCustomerCount: 10,
            groupbuy7dRevisitRate: 0.33,
            groupbuy7dCardOpenedCustomerCount: 4,
            groupbuy7dCardOpenedRate: 0.13,
            groupbuy7dStoredValueConvertedCustomerCount: 5,
            groupbuy7dStoredValueConversionRate: 0.17,
            groupbuy30dMemberPayConvertedCustomerCount: 8,
            groupbuy30dMemberPayConversionRate: 0.27,
            groupbuyFirstOrderCustomerCount: 12,
            groupbuyFirstOrderHighValueMemberCustomerCount: 2,
            groupbuyFirstOrderHighValueMemberRate: 0.17,
            effectiveMembers: orgId === "1001" ? 180 : 130,
            sleepingMembers: orgId === "1001" ? 29 : 31,
            sleepingMemberRate: orgId === "1001" ? 29 / 180 : 31 / 130,
            newMembers7d: orgId === "1001" ? 9 : 5,
            activeTechCount7d: orgId === "1001" ? 7 : 5,
            currentStoredBalance: orgId === "1001" ? 96000 : 55000,
            storedBalanceLifeMonths: orgId === "1001" ? 3.8 : 2.4,
            renewalPressureIndex30d: orgId === "1001" ? 1.18 : 1.46,
            memberRepurchaseBaseCustomerCount7d: 42,
            memberRepurchaseReturnedCustomerCount7d: 16,
            memberRepurchaseRate7d: 16 / 42,
          },
        ]),
        listStoreSummary30dByDateRange: vi.fn(async ({ orgId }) => [
          {
            orgId,
            windowEndBizDate: "2026-04-11",
            storeName: orgId === "1001" ? "迎宾店" : "义乌店",
            revenue30d: orgId === "1001" ? 88000 : 64000,
            orderCount30d: orgId === "1001" ? 540 : 410,
            totalClocks30d: orgId === "1001" ? 1180 : 790,
            clockEffect30d: orgId === "1001" ? 74.6 : 61.3,
            averageTicket30d: orgId === "1001" ? 163 : 156,
            pointClockRate30d: orgId === "1001" ? 0.46 : 0.29,
            addClockRate30d: orgId === "1001" ? 0.31 : 0.07,
            rechargeCash30d: orgId === "1001" ? 21000 : 10800,
            storedConsumeAmount30d: orgId === "1001" ? 32000 : 12100,
            storedConsumeRate30d: orgId === "1001" ? 0.68 : 0.39,
            onDutyTechCount30d: orgId === "1001" ? 9 : 6,
            groupbuyOrderShare30d: 0.2,
            groupbuyCohortCustomerCount: 120,
            groupbuy7dRevisitCustomerCount: 40,
            groupbuy7dRevisitRate: 0.33,
            groupbuy7dCardOpenedCustomerCount: 18,
            groupbuy7dCardOpenedRate: 0.15,
            groupbuy7dStoredValueConvertedCustomerCount: 20,
            groupbuy7dStoredValueConversionRate: 0.17,
            groupbuy30dMemberPayConvertedCustomerCount: 36,
            groupbuy30dMemberPayConversionRate: 0.3,
            groupbuyFirstOrderCustomerCount: 48,
            groupbuyFirstOrderHighValueMemberCustomerCount: 8,
            groupbuyFirstOrderHighValueMemberRate: 1 / 6,
            effectiveMembers: orgId === "1001" ? 180 : 130,
            sleepingMembers: orgId === "1001" ? 29 : 31,
            sleepingMemberRate: orgId === "1001" ? 29 / 180 : 31 / 130,
            newMembers30d: orgId === "1001" ? 36 : 20,
            activeTechCount30d: orgId === "1001" ? 8 : 5,
            currentStoredBalance: orgId === "1001" ? 96000 : 55000,
            storedBalanceLifeMonths: orgId === "1001" ? 3.8 : 2.4,
            renewalPressureIndex30d: orgId === "1001" ? 1.18 : 1.46,
            memberRepurchaseBaseCustomerCount7d: 42,
            memberRepurchaseReturnedCustomerCount7d: 16,
            memberRepurchaseRate7d: 16 / 42,
          },
        ]),
      } as never,
    });

    const pack = await service.buildAnalysisEvidencePack({
      jobId: "ANL-PORTFOLIO-1",
      orgId: "scope:1001,1002",
      channel: "wecom",
      senderId: "hq-1",
      rawText: "两店近15天整体哪里不对",
      timeFrameLabel: "近15天",
      startBizDate: "2026-03-28",
      endBizDate: "2026-04-11",
      jobType: "store_review",
      status: "running",
      createdAt: "2026-04-12T01:00:00.000Z",
      updatedAt: "2026-04-12T01:00:00.000Z",
      queueDisposition: "created",
    } as never);

    expect(pack.scopeType).toBe("portfolio");
    expect(pack.markdown).toContain("范围: 2店");
    expect(pack.markdown).toContain("最新日报样本");
    expect(pack.markdown).toContain("稳定摘要样本");
    expect(pack.facts).toEqual(
      expect.objectContaining({
        latestReports: expect.any(Array),
        portfolioSnapshots: expect.arrayContaining([
          expect.objectContaining({
            orgId: "1002",
            storeName: "义乌店",
            summary30d: expect.objectContaining({
              revenue30d: 64000,
              renewalPressureIndex30d: 1.46,
            }),
          }),
        ]),
      }),
    );
  });
});
