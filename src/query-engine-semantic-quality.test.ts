import { describe, expect, it, vi } from "vitest";
import { resolveHetangOpsConfig } from "./config.js";
import { executeHetangQuery } from "./query-engine.js";
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
    stores: [{ orgId: "1001", storeName: "义乌店", rawAliases: ["义乌"] }],
  });
}

const HQ_BINDING: HetangEmployeeBinding = {
  channel: "wecom",
  senderId: "hq-1",
  employeeName: "总部甲",
  role: "hq",
  isActive: true,
};

const STORE_BINDING: HetangEmployeeBinding = {
  channel: "wecom",
  senderId: "manager-1",
  employeeName: "义乌店长",
  role: "manager",
  orgId: "1001",
  scopeOrgIds: ["1001"],
  isActive: true,
};

describe("executeHetangQuery semantic quality integration", () => {
  it("records rule clarifier telemetry for scoped open guidance asks that still miss a concrete metric", async () => {
    const recordSemanticExecutionAudit = vi.fn().mockResolvedValue(undefined);
    const runtime = {
      buildReport: vi.fn(),
      resolveSemanticFallbackIntent: vi.fn(),
      recordSemanticExecutionAudit,
    };

    await executeHetangQuery({
      runtime: runtime as never,
      config: buildConfig(),
      binding: HQ_BINDING,
      text: "义乌店昨天盘里收了多少",
      now: new Date("2026-04-17T10:00:00+08:00"),
    });

    expect(recordSemanticExecutionAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        entry: "query",
        rawText: "义乌店昨天盘里收了多少",
        entrySource: "rule_clarifier",
        clarificationReason: "missing-metric",
        success: false,
      }),
    );
  });

  it("records fallback_used=true when AI semantic fallback produces a clarification", async () => {
    const recordSemanticExecutionAudit = vi.fn().mockResolvedValue(undefined);
    const runtime = {
      buildReport: vi.fn(),
      resolveSemanticFallbackIntent: vi.fn().mockResolvedValue({
        clarificationText: "这句话里的门店范围还不够清楚，请先说具体门店或直接问五店全景。",
        clarificationReason: "missing-metric",
      }),
      recordSemanticExecutionAudit,
    };

    await executeHetangQuery({
      runtime: runtime as never,
      config: buildConfig(),
      binding: HQ_BINDING,
      text: "义乌店昨天盘收咋样",
      now: new Date("2026-04-17T10:00:00+08:00"),
    });

    expect(recordSemanticExecutionAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        entry: "query",
        rawText: "义乌店昨天盘收咋样",
        entrySource: "ai_fallback",
        clarificationReason: "missing-metric",
        success: false,
      }),
    );
  });

  it("records analysis lens telemetry for open analysis asks that are safely upgraded from metric-like wording", async () => {
    const recordSemanticExecutionAudit = vi.fn().mockResolvedValue(undefined);
    const runtime = {
      buildReport: vi.fn().mockResolvedValue({
        orgId: "1001",
        storeName: "义乌店",
        bizDate: "2026-04-16",
        metrics: {
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-04-16",
          serviceRevenue: 1800,
          rechargeCash: 500,
          rechargeStoredValue: 680,
          rechargeBonusValue: 180,
          antiServiceRevenue: 0,
          serviceOrderCount: 18,
          customerCount: 18,
          averageTicket: 100,
          totalClockCount: 20,
          upClockRecordCount: 20,
          pointClockRecordCount: 6,
          pointClockRate: 0.3,
          addClockRecordCount: 3,
          addClockRate: 0.15,
          clockRevenue: 1800,
          clockEffect: 75,
          activeTechCount: 5,
          onDutyTechCount: 9,
          techCommission: 500,
          techCommissionRate: 0.28,
          marketRevenue: 120,
          marketCommission: 24,
          memberPaymentAmount: 900,
          memberPaymentShare: 0.5,
          cashPaymentAmount: 200,
          cashPaymentShare: 0.11,
          wechatPaymentAmount: 500,
          wechatPaymentShare: 0.28,
          alipayPaymentAmount: 200,
          alipayPaymentShare: 0.11,
          storedConsumeAmount: 360,
          storedConsumeRate: 0.72,
          groupbuyOrderCount: 0,
          groupbuyOrderShare: 0,
          groupbuyAmount: 0,
          groupbuyAmountShare: 0,
          groupbuyPlatformBreakdown: [],
          groupbuyCohortCustomerCount: 0,
          groupbuyRevisitCustomerCount: 0,
          groupbuyRevisitRate: null,
          groupbuyMemberPayConvertedCustomerCount: 0,
          groupbuyMemberPayConversionRate: null,
          groupbuy7dRevisitCustomerCount: 0,
          groupbuy7dRevisitRate: null,
          groupbuy7dCardOpenedCustomerCount: 0,
          groupbuy7dCardOpenedRate: null,
          groupbuy7dStoredValueConvertedCustomerCount: 0,
          groupbuy7dStoredValueConversionRate: null,
          groupbuy30dMemberPayConvertedCustomerCount: 0,
          groupbuy30dMemberPayConversionRate: null,
          groupbuyFirstOrderCustomerCount: 0,
          groupbuyFirstOrderHighValueMemberCustomerCount: 0,
          groupbuyFirstOrderHighValueMemberRate: null,
          effectiveMembers: 120,
          newMembers: 5,
          sleepingMembers: 18,
          sleepingMemberRate: 0.15,
          currentStoredBalance: 56000,
          roomOccupancyRate: 0.61,
          roomTurnoverRate: 2.2,
          grossMarginRate: 0.44,
          netMarginRate: 0.06,
          breakEvenRevenue: 12000,
          incompleteSync: false,
          unavailableMetrics: [],
          storedBalanceLifeMonths: 1.8,
          renewalPressureIndex30d: 1.42,
          memberRepurchaseBaseCustomerCount7d: 24,
          memberRepurchaseReturnedCustomerCount7d: 8,
          memberRepurchaseRate7d: 8 / 24,
          staleSyncEndpoints: [],
        },
        alerts: [],
        suggestions: [],
        markdown: "",
        complete: true,
      }),
      getCurrentServingVersion: vi.fn().mockResolvedValue("serving-20260418040000"),
      resolveSemanticFallbackIntent: vi.fn(),
      recordSemanticExecutionAudit,
    };

    await executeHetangQuery({
      runtime: runtime as never,
      config: buildConfig(),
      binding: STORE_BINDING,
      text: "义乌店近7天重点看什么，毛利率、净利率还是保本营收",
      now: new Date("2026-04-17T10:00:00+08:00"),
    });

    expect(recordSemanticExecutionAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        entry: "query",
        rawText: "义乌店近7天重点看什么，毛利率、净利率还是保本营收",
        semanticLane: "query",
        intentKind: "advice",
        analysisFrameworkId: "store_profit_diagnosis_v1",
        analysisPersonaId: "profit_exec_cfo_v1",
        routeUpgradeKind: "metric_to_advice",
        servingVersion: "serving-20260418040000",
        deployMarker: "serving:serving-20260418040000",
        success: true,
      }),
    );
  });
});
