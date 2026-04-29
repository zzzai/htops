import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveHetangOpsConfig } from "../config.js";
import {
  closeHetangToolsServer,
  createHetangToolsServer,
  type HetangToolCallRequest,
} from "./server.js";

const activeServers: Array<{ close: () => Promise<void> }> = [];
const describeLocalhost =
  process.env.HTOPS_ENABLE_LOCALHOST_TESTS === "1" ? describe : describe.skip;

afterEach(async () => {
  while (activeServers.length > 0) {
    const server = activeServers.pop();
    if (server) {
      await server.close();
    }
  }
});

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
      {
        orgId: "1001",
        storeName: "迎宾店",
        rawAliases: ["迎宾"],
      },
    ],
    sync: { enabled: false },
    reporting: { enabled: false },
  });
}

function buildRuntime() {
  return {
    listStoreManagerDailyKpiByDateRange: vi.fn().mockResolvedValue([
      {
        bizDate: "2026-04-10",
        orgId: "1001",
        storeName: "迎宾店",
        dailyActualRevenue: 12345,
        dailyCardConsume: 4567,
        dailyOrderCount: 89,
        totalClocks: 110,
        assignClocks: 48,
        queueClocks: 62,
        pointClockRate: 0.436,
        averageTicket: 138.7,
        clockEffect: 112.2,
      },
    ]),
    listStoreReview7dByDateRange: vi.fn().mockResolvedValue([
      {
        orgId: "1001",
        windowEndBizDate: "2026-04-10",
        storeName: "迎宾店",
        revenue7d: 70000,
        orderCount7d: 520,
        customerCount7d: 520,
        totalClocks7d: 620,
        clockEffect7d: 112.9,
        averageTicket7d: 134.6,
        pointClockRate7d: 0.31,
        addClockRate7d: 0.09,
        rechargeCash7d: 18000,
        storedConsumeAmount7d: 25000,
        storedConsumeRate7d: 0.28,
        onDutyTechCount7d: 16,
        groupbuyOrderShare7d: 0.41,
        groupbuyCohortCustomerCount: 120,
        groupbuy7dRevisitCustomerCount: 19,
        groupbuy7dRevisitRate: 0.16,
        groupbuy7dCardOpenedCustomerCount: 9,
        groupbuy7dCardOpenedRate: 0.075,
        groupbuy7dStoredValueConvertedCustomerCount: 4,
        groupbuy7dStoredValueConversionRate: 0.033,
        groupbuy30dMemberPayConvertedCustomerCount: 11,
        groupbuy30dMemberPayConversionRate: 0.092,
        groupbuyFirstOrderCustomerCount: 36,
        groupbuyFirstOrderHighValueMemberCustomerCount: 5,
        groupbuyFirstOrderHighValueMemberRate: 0.139,
        effectiveMembers: 880,
        sleepingMembers: 402,
        sleepingMemberRate: 0.457,
        newMembers7d: 28,
        activeTechCount7d: 13,
        currentStoredBalance: 356000,
        storedBalanceLifeMonths: 2.4,
        renewalPressureIndex30d: 0.68,
        memberRepurchaseBaseCustomerCount7d: 132,
        memberRepurchaseReturnedCustomerCount7d: 36,
        memberRepurchaseRate7d: 0.273,
      },
    ]),
    listStoreSummary30dByDateRange: vi.fn().mockResolvedValue([
      {
        orgId: "1001",
        windowEndBizDate: "2026-04-10",
        storeName: "迎宾店",
        revenue30d: 298000,
        orderCount30d: 2150,
        customerCount30d: 2150,
        totalClocks30d: 2640,
        clockEffect30d: 112.9,
        averageTicket30d: 138.6,
        pointClockRate30d: 0.33,
        addClockRate30d: 0.08,
        rechargeCash30d: 82000,
        storedConsumeAmount30d: 103000,
        storedConsumeRate30d: 0.31,
        onDutyTechCount30d: 17,
        groupbuyOrderShare30d: 0.39,
        groupbuyCohortCustomerCount: 420,
        groupbuy7dRevisitCustomerCount: 58,
        groupbuy7dRevisitRate: 0.138,
        groupbuy7dCardOpenedCustomerCount: 31,
        groupbuy7dCardOpenedRate: 0.074,
        groupbuy7dStoredValueConvertedCustomerCount: 12,
        groupbuy7dStoredValueConversionRate: 0.029,
        groupbuy30dMemberPayConvertedCustomerCount: 35,
        groupbuy30dMemberPayConversionRate: 0.083,
        groupbuyFirstOrderCustomerCount: 121,
        groupbuyFirstOrderHighValueMemberCustomerCount: 16,
        groupbuyFirstOrderHighValueMemberRate: 0.132,
        effectiveMembers: 880,
        sleepingMembers: 402,
        sleepingMemberRate: 0.457,
        newMembers30d: 103,
        activeTechCount30d: 14,
        currentStoredBalance: 356000,
        storedBalanceLifeMonths: 2.4,
        renewalPressureIndex30d: 0.68,
        memberRepurchaseBaseCustomerCount7d: 132,
        memberRepurchaseReturnedCustomerCount7d: 36,
        memberRepurchaseRate7d: 0.273,
      },
    ]),
    listMemberReactivationQueue: vi.fn().mockResolvedValue([
      {
        orgId: "1001",
        bizDate: "2026-04-10",
        memberId: "M001",
        customerIdentityKey: "member:M001",
        customerDisplayName: "张女士",
        memberCardNo: "8888",
        referenceCode: "13800008888",
        primarySegment: "important-reactivation-member",
        followupBucket: "high-value-reactivation",
        reactivationPriorityScore: 781.4,
        strategyPriorityScore: 812.2,
        executionPriorityScore: 826.8,
        priorityBand: "P0",
        priorityRank: 1,
        churnRiskLabel: "critical",
        churnRiskScore: 0.93,
        revisitWindowLabel: "due-now",
        recommendedActionLabel: "immediate-1to1",
        recommendedTouchWeekday: "Friday",
        recommendedTouchDaypart: "late-night",
        touchWindowLabel: "best-today",
        reasonSummary: "高价值会员已沉默 19 天，余额正在下滑。",
        touchAdviceSummary: "今晚 21:00 后一对一关怀，优先约熟悉技师。",
        daysSinceLastVisit: 19,
        visitCount90d: 6,
        payAmount90d: 2680,
        currentStoredBalanceInferred: 780,
        projectedBalanceDaysLeft: 24,
        birthdayMonthDay: "04-15",
        nextBirthdayBizDate: "2026-04-15",
        birthdayWindowDays: 5,
        birthdayBoostScore: 18,
        topTechName: "王技师",
        queueJson: "{}",
        updatedAt: "2026-04-10T08:00:00+08:00",
      },
    ]),
    listMemberReactivationFeatures: vi.fn().mockResolvedValue([
      {
        orgId: "1001",
        bizDate: "2026-04-10",
        memberId: "M001",
        customerIdentityKey: "member:M001",
        customerDisplayName: "张女士",
        memberCardNo: "8888",
        referenceCode: "13800008888",
        primarySegment: "important-reactivation-member",
        daysSinceLastVisit: 19,
        visitCount30d: 1,
        visitCount90d: 6,
        payAmount30d: 0,
        payAmount90d: 2680,
        memberPayAmount30d: 0,
        memberPayAmount90d: 1800,
        rechargeTotal30d: 0,
        rechargeTotal90d: 1200,
        rechargeCount30d: 0,
        rechargeCount90d: 1,
        daysSinceLastRecharge: 63,
        currentStoredBalanceInferred: 780,
        storedBalance7dAgo: 980,
        storedBalance30dAgo: 1560,
        storedBalance90dAgo: 2180,
        storedBalanceDelta7d: -200,
        storedBalanceDelta30d: -780,
        storedBalanceDelta90d: -1400,
        depletionVelocity30d: 26,
        projectedBalanceDaysLeft: 24,
        rechargeToMemberPayRatio90d: 0.66,
        dominantVisitDaypart: "late-night",
        preferredDaypartShare90d: 0.67,
        dominantVisitWeekday: "Friday",
        preferredWeekdayShare90d: 0.5,
        dominantVisitMonthPhase: "mid-month",
        preferredMonthPhaseShare90d: 0.44,
        weekendVisitShare90d: 0.58,
        lateNightVisitShare90d: 0.67,
        overnightVisitShare90d: 0.11,
        averageVisitGapDays90d: 13.6,
        visitGapStddevDays90d: 3.2,
        cycleDeviationScore: 0.18,
        timePreferenceConfidenceScore: 0.74,
        trajectoryConfidenceScore: 0.78,
        reactivationPriorityScore: 781.4,
        featureJson: "{}",
      },
    ]),
    listMemberReactivationStrategies: vi.fn().mockResolvedValue([
      {
        orgId: "1001",
        bizDate: "2026-04-10",
        memberId: "M001",
        customerIdentityKey: "member:M001",
        customerDisplayName: "张女士",
        primarySegment: "important-reactivation-member",
        reactivationPriorityScore: 781.4,
        churnRiskScore: 0.93,
        churnRiskLabel: "critical",
        revisitProbability7d: 0.31,
        revisitWindowLabel: "due-now",
        recommendedTouchWeekday: "Friday",
        recommendedTouchDaypart: "late-night",
        touchWindowMatchScore: 0.82,
        touchWindowLabel: "best-today",
        lifecycleMomentumScore: 0.26,
        lifecycleMomentumLabel: "cooling",
        recommendedActionLabel: "immediate-1to1",
        strategyPriorityScore: 812.2,
        strategyJson: "{}",
      },
    ]),
    listCurrentMemberCards: vi.fn().mockResolvedValue([]),
    listConsumeBillsByDateRange: vi.fn().mockResolvedValue([]),
    listCustomerTechLinksByDateRange: vi.fn().mockResolvedValue([]),
    listTechUpClockByDateRange: vi.fn().mockResolvedValue([]),
    listTechMarketByDateRange: vi.fn().mockResolvedValue([]),
    listCustomerSegments: vi.fn().mockResolvedValue([]),
    findCurrentMembersByPhoneSuffix: vi.fn().mockResolvedValue([
      {
        orgId: "1001",
        memberId: "M001",
        name: "张女士",
        phone: "13800008888",
        sex: "女",
        birthday: "1994-04-15",
        totalAmount: 1200,
        totalCount: 9,
        avgAmount: 133.3,
        lastConsumeTime: "2026-03-22 22:30:00",
        memberLevelName: "金卡",
        code: "VIP-M001",
        isLost: false,
        regStore: "迎宾店",
        regTime: "2025-10-01 12:00:00",
        storeName: "迎宾店",
        rawJson: "{}",
      },
    ]),
    listCurrentMembers: vi.fn().mockResolvedValue([]),
    listCustomerProfile90dByDateRange: vi.fn().mockResolvedValue([
      {
        orgId: "1001",
        windowEndBizDate: "2026-04-10",
        customerIdentityKey: "member:M001",
        customerIdentityType: "member",
        customerDisplayName: "张女士",
        memberId: "M001",
        memberCardNo: "8888",
        referenceCode: "13800008888",
        memberLabel: "金卡",
        phone: "13800008888",
        identityStable: true,
        segmentEligible: true,
        firstBizDate: "2025-10-01",
        lastBizDate: "2026-03-22",
        daysSinceLastVisit: 19,
        visitCount30d: 1,
        visitCount90d: 6,
        payAmount30d: 0,
        payAmount90d: 2680,
        memberPayAmount90d: 1800,
        groupbuyAmount90d: 500,
        directPayAmount90d: 380,
        distinctTechCount90d: 2,
        topTechCode: "T001",
        topTechName: "王技师",
        topTechVisitCount90d: 4,
        topTechVisitShare90d: 0.67,
        recencySegment: "active-30d",
        frequencySegment: "medium-2-3",
        monetarySegment: "high-1000-plus",
        paymentSegment: "mixed-member-nonmember",
        techLoyaltySegment: "single-tech-loyal",
        primarySegment: "important-reactivation-member",
        tagKeys: ["important-reactivation-member", "birthday-window"],
        currentStoredAmount: 780,
        currentConsumeAmount: 4200,
        currentCreatedTime: "2025-10-01T12:00:00+08:00",
        currentLastConsumeTime: "2026-03-22T22:30:00+08:00",
        currentSilentDays: 19,
        firstGroupbuyBizDate: "2025-10-03",
        revisitWithin7d: false,
        revisitWithin30d: true,
        cardOpenedWithin7d: false,
        storedValueConvertedWithin7d: false,
        memberPayConvertedWithin30d: true,
        highValueMemberWithin30d: true,
      },
    ]),
  };
}

async function startServer() {
  const runtime = buildRuntime();
  const server = createHetangToolsServer({
    token: "tools-secret",
    host: "127.0.0.1",
    port: 0,
    dedupeTtlMs: 42_000,
    config: buildConfig(),
    runtime: runtime as never,
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
    now: () => new Date("2026-04-11T12:00:00+08:00"),
  });
  await server.listen();
  activeServers.push(server);
  return { server, runtime };
}

async function callTool(serverBaseUrl: string, body: HetangToolCallRequest, token = "tools-secret") {
  const response = await fetch(`${serverBaseUrl}/v1/tools/call`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-htops-tools-token": token,
    },
    body: JSON.stringify(body),
  });
  return response;
}

describeLocalhost("createHetangToolsServer", () => {
  it("rejects requests without the tool token", async () => {
    const { server } = await startServer();

    const response = await fetch(`${server.baseUrl}/v1/tools/capabilities`);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "unauthorized",
    });
  });

  it("lists callable tool capabilities", async () => {
    const { server } = await startServer();

    const response = await fetch(`${server.baseUrl}/v1/tools/capabilities`, {
      headers: {
        "x-htops-tools-token": "tools-secret",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      capabilities: {
        version: "v1",
        contract_version: "2026-04-29.tools.v2",
        execution_boundary: {
          entry_role: "function_call_entry_adapter",
          access_mode: "read_only",
          business_logic_owner: "owner_modules",
        },
        request_dedupe: {
          scope: "tools_http",
          key_fields: ["request_id"],
          ttl_ms: 42_000,
        },
        tools: expect.arrayContaining([
          expect.objectContaining({
            name: "get_store_daily_summary",
            entry_role: "function_call_entry_adapter",
            lane: "query",
            owner_surface: "tool_facade",
            semantic_capability_ids: ["store_day_summary_v1"],
            arguments_schema: expect.objectContaining({
              type: "object",
              additionalProperties: false,
            }),
          }),
          expect.objectContaining({
            name: "get_member_recall_candidates",
            entry_role: "function_call_entry_adapter",
            lane: "query",
          }),
          expect.objectContaining({
            name: "explain_metric_definition",
            entry_role: "function_call_entry_adapter",
            lane: "meta",
            owner_surface: "metric_registry",
          }),
          expect.objectContaining({
            name: "search_operating_knowledge",
            entry_role: "function_call_entry_adapter",
            lane: "meta",
            owner_surface: "knowledge_registry",
          }),
        ]),
      },
    });
  });

  it("returns structured store daily summary payloads", async () => {
    const { server, runtime } = await startServer();

    const response = await callTool(server.baseUrl, {
      request_id: "tool-store-summary-1",
      tool: "get_store_daily_summary",
      arguments: {
        store: "迎宾店",
        biz_date: "2026-04-10",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      tool: "get_store_daily_summary",
      result: {
        org_id: "1001",
        store_name: "迎宾店",
        biz_date: "2026-04-10",
        metrics: {
          revenue: 12345,
          order_count: 89,
          point_clock_rate: 0.436,
        },
      },
    });
    expect(runtime.listStoreManagerDailyKpiByDateRange).toHaveBeenCalledWith({
      orgId: "1001",
      startBizDate: "2026-04-10",
      endBizDate: "2026-04-10",
    });
  });

  it("returns store risk scan signals from 7d and 30d windows", async () => {
    const { server } = await startServer();

    const response = await callTool(server.baseUrl, {
      request_id: "tool-risk-scan-1",
      tool: "get_store_risk_scan",
      arguments: {
        store: "迎宾",
        biz_date: "2026-04-10",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      tool: "get_store_risk_scan",
      result: {
        store_name: "迎宾店",
        window_end_biz_date: "2026-04-10",
        signals: expect.arrayContaining([
          expect.objectContaining({ key: "low_member_store_consume_rate", severity: "high" }),
          expect.objectContaining({ key: "weak_addon_rate", severity: "high" }),
        ]),
      },
    });
  });

  it("returns ranked member recall candidates with features and strategy hints", async () => {
    const { server } = await startServer();

    const response = await callTool(server.baseUrl, {
      request_id: "tool-recall-1",
      tool: "get_member_recall_candidates",
      arguments: {
        store: "迎宾店",
        biz_date: "2026-04-10",
        limit: 5,
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      tool: "get_member_recall_candidates",
      result: {
        store_name: "迎宾店",
        snapshot_biz_date: "2026-04-10",
        candidates: [
          expect.objectContaining({
            member_id: "M001",
            customer_name: "张女士",
            priority_band: "P0",
            recommended_action: "immediate-1to1",
            recommended_touch: expect.objectContaining({
              weekday: "Friday",
              daypart: "late-night",
            }),
          }),
        ],
      },
    });
  });

  it("returns a customer profile by phone suffix without exposing raw tables", async () => {
    const { server } = await startServer();

    const response = await callTool(server.baseUrl, {
      request_id: "tool-profile-1",
      tool: "get_customer_profile",
      arguments: {
        store: "迎宾店",
        phone_suffix: "8888",
        biz_date: "2026-04-10",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      tool: "get_customer_profile",
      result: {
        store_name: "迎宾店",
        snapshot_biz_date: "2026-04-10",
        matched_members: [
          expect.objectContaining({
            member_id: "M001",
            customer_name: "张女士",
            phone_suffix: "8888",
            current_profile: expect.objectContaining({
              primary_segment: "important-reactivation-member",
              top_tech_name: "王技师",
            }),
          }),
        ],
      },
    });
  });

  it("returns a legacy profile fallback text when the 90d profile row is missing", async () => {
    const { server, runtime } = await startServer();
    runtime.listCustomerProfile90dByDateRange.mockResolvedValueOnce([]);
    runtime.listCurrentMemberCards = vi.fn().mockResolvedValue([
      {
        orgId: "1001",
        memberId: "M001",
        cardId: "card-001",
        cardNo: "yb8888",
        rawJson: "{}",
      },
    ]);
    runtime.listConsumeBillsByDateRange = vi.fn().mockResolvedValue([
      {
        orgId: "1001",
        settleId: "S-201",
        settleNo: "XF2604100001",
        payAmount: 298,
        consumeAmount: 298,
        discountAmount: 0,
        antiFlag: false,
        optTime: "2026-04-10 20:15:00",
        bizDate: "2026-04-10",
        rawJson: JSON.stringify({
          SettleId: "S-201",
          SettleNo: "XF2604100001",
          Payments: [{ Name: "会员", Amount: 298, PaymentType: 3 }],
          Infos: ["张女士 (金卡) [yb8888],消费298.00元;"],
        }),
      },
    ]);
    runtime.listCustomerTechLinksByDateRange = vi.fn().mockResolvedValue([
      {
        orgId: "1001",
        bizDate: "2026-04-10",
        settleId: "S-201",
        settleNo: "XF2604100001",
        customerIdentityKey: "member:M001",
        customerDisplayName: "张女士",
        memberId: "M001",
        referenceCode: "yb8888",
        identityStable: true,
        techCode: "T001",
        techName: "王技师",
        techTurnover: 298,
        itemNames: ["足道"],
        linkConfidence: "single-customer",
        rawJson: "{}",
      },
    ]);
    runtime.listTechUpClockByDateRange = vi.fn().mockResolvedValue([
      {
        orgId: "1001",
        bizDate: "2026-04-10",
        personCode: "T001",
        personName: "王技师",
        count: 1,
        clockType: "点钟",
        turnover: 298,
        comm: 88,
        rawJson: "{}",
      },
    ]);
    runtime.listTechMarketByDateRange = vi.fn().mockResolvedValue([]);
    runtime.listCustomerSegments = vi.fn().mockResolvedValue([
      {
        orgId: "1001",
        bizDate: "2026-04-10",
        customerIdentityKey: "member:M001",
        customerIdentityType: "member",
        customerDisplayName: "张女士",
        memberId: "M001",
        memberCardNo: "yb8888",
        referenceCode: "yb8888",
        memberLabel: "金卡",
        identityStable: true,
        segmentEligible: true,
        firstBizDate: "2025-10-01",
        lastBizDate: "2026-04-10",
        daysSinceLastVisit: 0,
        visitCount30d: 2,
        visitCount90d: 6,
        payAmount30d: 596,
        payAmount90d: 2680,
        memberPayAmount90d: 1800,
        groupbuyAmount90d: 500,
        directPayAmount90d: 380,
        distinctTechCount90d: 2,
        topTechCode: "T001",
        topTechName: "王技师",
        topTechVisitCount90d: 4,
        topTechVisitShare90d: 0.67,
        recencySegment: "active-30d",
        frequencySegment: "medium-2-3",
        monetarySegment: "high-1000-plus",
        paymentSegment: "mixed-member-nonmember",
        techLoyaltySegment: "single-tech-loyal",
        primarySegment: "important-reactivation-member",
        tagKeys: ["important-reactivation-member", "birthday-window"],
        rawJson: "{}",
      },
    ]);

    const response = await callTool(server.baseUrl, {
      request_id: "tool-profile-fallback-1",
      tool: "get_customer_profile",
      arguments: {
        store: "迎宾店",
        phone_suffix: "8888",
        biz_date: "2026-04-10",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      tool: "get_customer_profile",
      result: {
        store_name: "迎宾店",
        snapshot_biz_date: "2026-04-10",
        matched_members: [
          expect.objectContaining({
            member_id: "M001",
            current_profile: null,
          }),
        ],
        legacy_profile_text: expect.stringContaining("一句话判断"),
      },
    });
  });

  it("explains metric definitions through a deterministic dictionary", async () => {
    const { server } = await startServer();

    const response = await callTool(server.baseUrl, {
      request_id: "tool-metric-1",
      tool: "explain_metric_definition",
      arguments: {
        metric: "客单价",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      tool: "explain_metric_definition",
      result: {
        key: "averageTicket",
        label: "客单价",
        aliases: expect.arrayContaining(["客单价", "客单"]),
      },
    });
  });

  it("returns a stable not_found payload for unknown metric definitions", async () => {
    const { server } = await startServer();

    const response = await callTool(server.baseUrl, {
      request_id: "tool-metric-miss-1",
      tool: "explain_metric_definition",
      arguments: {
        metric: "神秘指标",
      },
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "metric_not_found",
    });
  });

  it("returns bounded operating knowledge search results without exposing fact tables", async () => {
    const { server } = await startServer();

    const response = await callTool(server.baseUrl, {
      request_id: "tool-knowledge-1",
      tool: "search_operating_knowledge",
      arguments: {
        query: "营收口径",
        limit: 2,
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      tool: "search_operating_knowledge",
      result: {
        scope: "knowledge_only",
        boundary: {
          allowed_domains: expect.arrayContaining(["metric_definition"]),
          blocked_fact_classes: expect.arrayContaining(["transaction_facts"]),
        },
        documents: [
          expect.objectContaining({
            domain: "metric_definition",
            title: expect.stringContaining("指标"),
          }),
        ],
      },
    });
  });

  it("deduplicates repeated tool calls by request_id", async () => {
    const { server, runtime } = await startServer();
    const payload: HetangToolCallRequest = {
      request_id: "tool-store-summary-dup",
      tool: "get_store_daily_summary",
      arguments: {
        store: "迎宾店",
        biz_date: "2026-04-10",
      },
    };

    const first = await callTool(server.baseUrl, payload);
    const second = await callTool(server.baseUrl, payload);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(runtime.listStoreManagerDailyKpiByDateRange).toHaveBeenCalledTimes(1);
  });
});
