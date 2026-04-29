import { describe, expect, it, vi } from "vitest";
import { resolveHetangOpsConfig } from "./config.js";
import { executeHetangQuery } from "./query-engine.js";
import type {
  CustomerProfile90dRow,
  MemberReactivationQueueRecord,
  CustomerSegmentRecord,
  CustomerTechLinkRecord,
  DailyStoreAlert,
  DailyStoreMetrics,
  DailyStoreReport,
  HetangEmployeeBinding,
  StoreManagerDailyKpiRow,
  StoreReview7dRow,
  StoreSummary30dRow,
  TechLeaderboardRow,
} from "./types.js";

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
      { orgId: "1001", storeName: "义乌店" },
      { orgId: "1002", storeName: "园中园店" },
      { orgId: "1003", storeName: "华美店" },
      { orgId: "1004", storeName: "锦苑店" },
      { orgId: "1005", storeName: "迎宾店" },
    ],
  });
}

function buildMetrics(overrides: Partial<DailyStoreMetrics> = {}): DailyStoreMetrics {
  return {
    orgId: "1001",
    storeName: "义乌店",
    bizDate: "2026-03-30",
    serviceRevenue: 3200,
    rechargeCash: 1000,
    rechargeStoredValue: 1200,
    rechargeBonusValue: 200,
    antiServiceRevenue: 120,
    serviceOrderCount: 16,
    customerCount: 16,
    averageTicket: 200,
    totalClockCount: 40,
    upClockRecordCount: 20,
    pointClockRecordCount: 10,
    pointClockRate: 0.5,
    addClockRecordCount: 5,
    addClockRate: 0.25,
    clockRevenue: 2800,
    clockEffect: 80,
    activeTechCount: 6,
    onDutyTechCount: 8,
    techCommission: 980,
    techCommissionRate: 0.35,
    marketRevenue: 480,
    marketCommission: 96,
    memberPaymentAmount: 2080,
    memberPaymentShare: 0.65,
    cashPaymentAmount: 256,
    cashPaymentShare: 0.08,
    wechatPaymentAmount: 384,
    wechatPaymentShare: 0.12,
    alipayPaymentAmount: 160,
    alipayPaymentShare: 0.05,
    storedConsumeAmount: 2080,
    storedConsumeRate: 2.08,
    groupbuyOrderCount: 4,
    groupbuyOrderShare: 0.25,
    groupbuyAmount: 720,
    groupbuyAmountShare: 0.225,
    groupbuyPlatformBreakdown: [
      { platform: "美团", orderCount: 3, orderShare: 0.1875, amount: 560, amountShare: 0.175 },
      { platform: "抖音", orderCount: 1, orderShare: 0.0625, amount: 160, amountShare: 0.05 },
    ],
    groupbuyCohortCustomerCount: 6,
    groupbuyRevisitCustomerCount: 2,
    groupbuyRevisitRate: 2 / 6,
    groupbuyMemberPayConvertedCustomerCount: 1,
    groupbuyMemberPayConversionRate: 1 / 6,
    groupbuy7dRevisitCustomerCount: 2,
    groupbuy7dRevisitRate: 2 / 6,
    groupbuy7dCardOpenedCustomerCount: 1,
    groupbuy7dCardOpenedRate: 1 / 6,
    groupbuy7dStoredValueConvertedCustomerCount: 1,
    groupbuy7dStoredValueConversionRate: 1 / 6,
    groupbuy30dMemberPayConvertedCustomerCount: 1,
    groupbuy30dMemberPayConversionRate: 1 / 6,
    groupbuyFirstOrderCustomerCount: 4,
    groupbuyFirstOrderHighValueMemberCustomerCount: 1,
    groupbuyFirstOrderHighValueMemberRate: 1 / 4,
    effectiveMembers: 120,
    newMembers: 5,
    sleepingMembers: 18,
    sleepingMemberRate: 0.15,
    currentStoredBalance: 15000,
    roomOccupancyRate: 0.75,
    roomTurnoverRate: 3.2,
    grossMarginRate: 0.55,
    netMarginRate: 0.18,
    breakEvenRevenue: 2500,
    incompleteSync: false,
    unavailableMetrics: [],
    ...overrides,
  };
}

function buildReport(params: {
  orgId: string;
  storeName: string;
  bizDate: string;
  metrics?: Partial<DailyStoreMetrics>;
  alerts?: DailyStoreAlert[];
  suggestions?: string[];
  complete?: boolean;
}): DailyStoreReport {
  return {
    orgId: params.orgId,
    storeName: params.storeName,
    bizDate: params.bizDate,
    metrics: buildMetrics({
      orgId: params.orgId,
      storeName: params.storeName,
      bizDate: params.bizDate,
      ...params.metrics,
    }),
    alerts: params.alerts ?? [],
    suggestions: params.suggestions ?? [],
    markdown: `${params.storeName} ${params.bizDate} 日报`,
    complete: params.complete ?? true,
  };
}

function buildRuntime(params: {
  reports?: Record<string, DailyStoreReport>;
  cachedReports?: Record<string, DailyStoreReport | null>;
  leaderboard?: TechLeaderboardRow[];
  customerSegments?: Record<string, CustomerSegmentRecord[]>;
  memberReactivationQueue?: Record<string, MemberReactivationQueueRecord[]>;
  customerProfileRows?: Record<string, CustomerProfile90dRow[]>;
  customerTechLinks?: Record<string, CustomerTechLinkRecord[]>;
  dailyKpiRows?: Record<string, StoreManagerDailyKpiRow[]>;
  storeReviewRows?: Record<string, StoreReview7dRow[]>;
  storeSummary30dRows?: Record<string, StoreSummary30dRow[]>;
}) {
  return {
    buildReport: vi.fn(async ({ orgId, bizDate }: { orgId: string; bizDate?: string }) => {
      const key = `${orgId}:${bizDate ?? ""}`;
      const report = params.reports?.[key];
      if (!report) {
        throw new Error(`Missing stub report for ${key}`);
      }
      return report;
    }),
    getDailyReportSnapshot: vi.fn(
      async ({ orgId, bizDate }: { orgId: string; bizDate: string }) =>
        params.cachedReports?.[`${orgId}:${bizDate}`] ?? null,
    ),
    listTechLeaderboard: params.leaderboard
      ? vi.fn().mockResolvedValue(params.leaderboard)
      : undefined,
    listCustomerSegments: vi.fn(
      async ({ orgId, bizDate }: { orgId: string; bizDate: string }) =>
        params.customerSegments?.[`${orgId}:${bizDate}`] ?? [],
    ),
    listMemberReactivationQueue: vi.fn(
      async ({ orgId, bizDate }: { orgId: string; bizDate: string }) =>
        params.memberReactivationQueue?.[`${orgId}:${bizDate}`] ?? [],
    ),
    listCustomerProfile90dByDateRange: vi.fn(
      async ({
        orgId,
        startBizDate,
        endBizDate,
      }: {
        orgId: string;
        startBizDate: string;
        endBizDate: string;
      }) => params.customerProfileRows?.[`${orgId}:${startBizDate}:${endBizDate}`] ?? [],
    ),
    listCustomerTechLinks: vi.fn(
      async ({ orgId, bizDate }: { orgId: string; bizDate: string }) =>
        params.customerTechLinks?.[`${orgId}:${bizDate}`] ?? [],
    ),
    ...(params.customerTechLinks
      ? {
          listCustomerTechLinksByDateRange: vi.fn(
            async ({
              orgId,
              startBizDate,
              endBizDate,
            }: {
              orgId: string;
              startBizDate: string;
              endBizDate: string;
            }) => {
              const rows: CustomerTechLinkRecord[] = [];
              for (let cursor = startBizDate; cursor <= endBizDate; ) {
                rows.push(...(params.customerTechLinks?.[`${orgId}:${cursor}`] ?? []));
                const next = new Date(`${cursor}T00:00:00Z`);
                next.setUTCDate(next.getUTCDate() + 1);
                cursor = next.toISOString().slice(0, 10);
              }
              return rows;
            },
          ),
        }
      : {}),
    listStoreManagerDailyKpiByDateRange: vi.fn(
      async ({
        orgId,
        startBizDate,
        endBizDate,
      }: {
        orgId: string;
        startBizDate: string;
        endBizDate: string;
      }) => params.dailyKpiRows?.[`${orgId}:${startBizDate}:${endBizDate}`] ?? [],
    ),
    listStoreReview7dByDateRange: vi.fn(
      async ({
        orgId,
        startBizDate,
        endBizDate,
      }: {
        orgId: string;
        startBizDate: string;
        endBizDate: string;
      }) => params.storeReviewRows?.[`${orgId}:${startBizDate}:${endBizDate}`] ?? [],
    ),
    listStoreSummary30dByDateRange: vi.fn(
      async ({
        orgId,
        startBizDate,
        endBizDate,
      }: {
        orgId: string;
        startBizDate: string;
        endBizDate: string;
      }) => params.storeSummary30dRows?.[`${orgId}:${startBizDate}:${endBizDate}`] ?? [],
    ),
  };
}

function buildCustomerSegment(
  overrides: Partial<CustomerSegmentRecord> = {},
): CustomerSegmentRecord {
  return {
    orgId: "1001",
    bizDate: "2026-03-30",
    customerIdentityKey: "member:demo",
    customerIdentityType: "member",
    customerDisplayName: "演示顾客",
    memberId: "member-demo",
    memberCardNo: "yw-demo",
    referenceCode: "yw-demo",
    memberLabel: "金悦卡",
    identityStable: true,
    segmentEligible: true,
    firstBizDate: "2026-01-10",
    lastBizDate: "2026-03-30",
    daysSinceLastVisit: 0,
    visitCount30d: 3,
    visitCount90d: 6,
    payAmount30d: 680,
    payAmount90d: 1480,
    memberPayAmount90d: 1480,
    groupbuyAmount90d: 0,
    directPayAmount90d: 0,
    distinctTechCount90d: 1,
    topTechCode: "T001",
    topTechName: "杜莎",
    topTechVisitCount90d: 5,
    topTechVisitShare90d: 5 / 6,
    recencySegment: "active-7d",
    frequencySegment: "high-4-plus",
    monetarySegment: "high-1000-plus",
    paymentSegment: "member-only",
    techLoyaltySegment: "single-tech-loyal",
    primarySegment: "important-value-member",
    tagKeys: ["important-value-member", "single-tech-loyal"],
    rawJson: "{}",
    ...overrides,
  };
}

function buildCustomerProfile90dRow(
  overrides: Partial<CustomerProfile90dRow> = {},
): CustomerProfile90dRow {
  return {
    orgId: "1001",
    windowEndBizDate: "2026-03-30",
    customerIdentityKey: "member:demo",
    customerIdentityType: "member",
    customerDisplayName: "演示顾客",
    memberId: "member-demo",
    memberCardNo: "yw-demo",
    referenceCode: "yw-demo",
    memberLabel: "金悦卡",
    phone: "13800000000",
    identityStable: true,
    segmentEligible: true,
    firstBizDate: "2026-01-10",
    lastBizDate: "2026-03-30",
    daysSinceLastVisit: 0,
    visitCount30d: 3,
    visitCount90d: 6,
    payAmount30d: 680,
    payAmount90d: 1480,
    memberPayAmount90d: 1480,
    groupbuyAmount90d: 0,
    directPayAmount90d: 0,
    distinctTechCount90d: 1,
    topTechCode: "T001",
    topTechName: "杜莎",
    topTechVisitCount90d: 5,
    topTechVisitShare90d: 5 / 6,
    recencySegment: "active-7d",
    frequencySegment: "high-4-plus",
    monetarySegment: "high-1000-plus",
    paymentSegment: "member-only",
    techLoyaltySegment: "single-tech-loyal",
    primarySegment: "important-value-member",
    tagKeys: ["important-value-member"],
    currentStoredAmount: 1880,
    currentConsumeAmount: 2680,
    currentCreatedTime: "2026-01-10 10:00:00",
    currentLastConsumeTime: "2026-03-30 20:00:00",
    currentSilentDays: 0,
    firstGroupbuyBizDate: undefined,
    revisitWithin7d: false,
    revisitWithin30d: false,
    cardOpenedWithin7d: false,
    storedValueConvertedWithin7d: false,
    memberPayConvertedWithin30d: false,
    highValueMemberWithin30d: false,
    ...overrides,
  };
}

function buildCustomerTechLink(
  overrides: Partial<CustomerTechLinkRecord> = {},
): CustomerTechLinkRecord {
  return {
    orgId: "1001",
    bizDate: "2026-03-30",
    settleId: "S-001",
    settleNo: "NO-001",
    customerIdentityKey: "member:demo",
    customerIdentityType: "member",
    customerDisplayName: "演示顾客",
    memberId: "member-demo",
    memberCardNo: "yw-demo",
    referenceCode: "yw-demo",
    memberLabel: "金悦卡",
    identityStable: true,
    techCode: "T001",
    techName: "杜莎",
    customerCountInSettle: 1,
    techCountInSettle: 1,
    techTurnover: 298,
    techCommission: 88,
    orderPayAmount: 298,
    orderConsumeAmount: 298,
    itemNames: ["荷悦SPA"],
    linkConfidence: "single-customer",
    rawJson: "{}",
    ...overrides,
  };
}

function buildStoreSummary30dRow(overrides: Partial<StoreSummary30dRow> = {}): StoreSummary30dRow {
  return {
    orgId: "1001",
    windowEndBizDate: "2026-03-30",
    storeName: "义乌店",
    revenue30d: 120_000,
    orderCount30d: 720,
    customerCount30d: 720,
    totalClocks30d: 920,
    clockEffect30d: 130,
    averageTicket30d: 166.7,
    pointClockRate30d: 0.48,
    addClockRate30d: 0.29,
    rechargeCash30d: 42_000,
    storedConsumeAmount30d: 38_000,
    storedConsumeRate30d: 0.9,
    onDutyTechCount30d: 8,
    groupbuyOrderShare30d: 0.24,
    groupbuyCohortCustomerCount: 96,
    groupbuy7dRevisitCustomerCount: 34,
    groupbuy7dRevisitRate: 34 / 96,
    groupbuy7dCardOpenedCustomerCount: 18,
    groupbuy7dCardOpenedRate: 18 / 96,
    groupbuy7dStoredValueConvertedCustomerCount: 15,
    groupbuy7dStoredValueConversionRate: 15 / 96,
    groupbuy30dMemberPayConvertedCustomerCount: 24,
    groupbuy30dMemberPayConversionRate: 24 / 96,
    groupbuyFirstOrderCustomerCount: 44,
    groupbuyFirstOrderHighValueMemberCustomerCount: 7,
    groupbuyFirstOrderHighValueMemberRate: 7 / 44,
    effectiveMembers: 150,
    newMembers30d: 18,
    sleepingMembers: 28,
    sleepingMemberRate: 28 / 150,
    activeTechCount30d: 6,
    currentStoredBalance: 88_000,
    storedBalanceLifeMonths: 4.2,
    renewalPressureIndex30d: 0.9,
    memberRepurchaseBaseCustomerCount7d: 42,
    memberRepurchaseReturnedCustomerCount7d: 14,
    memberRepurchaseRate7d: 14 / 42,
    ...overrides,
  };
}

const HQ_BINDING: HetangEmployeeBinding = {
  channel: "wecom",
  senderId: "hq-1",
  employeeName: "总部甲",
  role: "hq",
  isActive: true,
};

describe("executeHetangQuery", () => {
  const config = buildConfig();
  const now = new Date("2026-03-31T09:00:00+08:00");

  it.each([
    ["义乌店昨天营收", "服务营收: 3200.00 元"],
    ["义乌店昨天进账多少", "服务营收: 3200.00 元"],
    ["义乌店昨天营业收入", "服务营收: 3200.00 元"],
    ["义乌店昨天客单价", "客单价: 200.00 元"],
    ["义乌店昨天单均金额", "单均金额: 200.00 元"],
    ["义乌店昨天会员消费占比", "会员消费占比: 65.0%"],
    ["义乌店昨天现金消费占比", "现金消费占比: 8.0%"],
    ["义乌店昨天微信支付占比", "微信支付占比: 12.0%"],
    ["义乌店昨天支付宝支付占比", "支付宝支付占比: 5.0%"],
    ["义乌店昨天充值金额", "充值现金: 1000.00 元"],
    ["义乌店昨天充值总额", "充值总额（含赠送）: 1200.00 元"],
    ["义乌店昨天储值", "充值总额（含赠送）: 1200.00 元"],
    ["义乌店昨天充值赠送", "充值赠送金额: 200.00 元"],
    ["义乌店昨天反结金额", "反结金额: 120.00 元"],
    ["义乌店昨天反结额", "反结金额: 120.00 元"],
    ["义乌店最近有没有反结情况", "反结金额: 120.00 元"],
    ["义乌店昨天订单数", "服务单数: 16 单"],
    ["义乌店昨天单量", "服务单数: 16 单"],
    ["义乌店昨天客数", "消费人数: 16 人"],
    ["义乌店昨天客流量", "消费人数: 16 人"],
    ["义乌店昨天储值多少", "充值总额（含赠送）: 1200.00 元"],
    ["义乌店昨天上客人数", "消费人数: 16 人"],
    ["义乌店昨天总钟数", "总钟数: 40 钟"],
    ["义乌店昨天总种数", "总钟数: 40 钟"],
    ["义乌店昨天活跃技师", "活跃技师: 6 人"],
    ["义乌店昨天在岗技师", "在岗技师: 8 人"],
    ["义乌店昨天技师提成金额", "技师提成金额: 980.00 元"],
    ["义乌店昨天技师提成占比", "技师提成占比: 35.0%"],
    ["义乌店昨天技师提成率", "技师提成占比: 35.0%"],
    ["义乌店昨天推销营收", "推销营收: 480.00 元"],
    ["义乌店昨天推销提成", "推销提成: 96.00 元"],
    ["义乌店昨天团购单数", "团购单数: 4 单"],
    ["义乌店昨天团购单量", "团购单数: 4 单"],
    ["义乌店昨天团购订单量", "团购单数: 4 单"],
    ["义乌店昨天团购金额", "团购金额: 720.00 元"],
    ["义乌店昨天团购复到店人数", "团购复到店人数: 2 人"],
    ["义乌店昨天团购回头率", "团购复到店率: 33.3%"],
    ["义乌店昨天团购后会员支付转化人数", "团购后会员支付转化人数: 1 人"],
    ["义乌店昨天7天回头率", "7天复到店率: 33.3%（2/6）"],
    ["义乌店昨天7天复到店率", "7天复到店率: 33.3%（2/6）"],
    ["义乌店昨天7天开卡率", "7天开卡率: 16.7%（1/6）"],
    ["义乌店昨天7天办卡率", "7天开卡率: 16.7%（1/6）"],
    ["义乌店昨天7天储值转化率", "7天储值转化率: 16.7%（1/6）"],
    ["义乌店昨天7天转储值率", "7天储值转化率: 16.7%（1/6）"],
    ["义乌店昨天30天会员消费转化率", "30天会员消费转化率: 16.7%（1/6）"],
    ["义乌店昨天30天转会员消费率", "30天会员消费转化率: 16.7%（1/6）"],
    ["义乌店昨天团购首单客转高价值会员率", "团购首单客转高价值会员率: 25.0%（1/4）"],
    ["义乌店昨天新增会员", "新增会员: 5 人"],
    ["义乌店今天来了几个新客", "新增会员: 5 人"],
    ["义乌店昨天有效会员", "有效会员: 120 人"],
    ["义乌店昨天沉默会员", "沉默会员: 18 人"],
    ["义乌店昨天沉默率", "沉默率: 15.0%"],
    ["义乌店昨天储值余额", "当前储值余额: 15000.00 元"],
    ["义乌店当前卡余额", "当前储值余额: 15000.00 元"],
    ["义乌店卡里还有多少", "当前储值余额: 15000.00 元"],
    ["义乌店会员卡还有多少", "当前储值余额: 15000.00 元"],
    ["义乌店昨天单钟产值", "钟效: 80.00 元/钟"],
    ["义乌店昨天上钟金额", "上钟产值: 2800.00 元"],
    ["义乌店昨天点钟率", "点钟率: 50.0%（10/20）"],
    ["义乌店昨天加钟率", "加钟率: 25.0%（5/20）"],
    ["义乌店昨天点钟数量", "点钟数量: 10 个"],
    ["义乌店昨天加钟数量", "加钟数量: 5 个"],
    ["义乌店昨天点钟", "点钟数量: 10 个"],
    ["义乌店昨天加钟", "加钟数量: 5 个"],
    ["义乌店今天加钟加了几个", "加钟数量: 5 个"],
    ["义乌店昨天包间上座率", "包间上座率: 75.0%"],
    ["义乌店昨天翻房率", "翻房率: 3.20 次/间"],
    ["义乌店昨天毛利率", "毛利率: 55.0%"],
    ["义乌店昨天净利率", "净利率: 18.0%"],
    ["义乌店昨天保本营收", "保本营收: 2500.00 元"],
  ])("answers field-backed metric query: %s", async (text, expectedSnippet) => {
    const runtime = buildRuntime({
      reports: {
        "1001:2026-03-30": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-30",
        }),
        "1001:2026-03-31": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-31",
        }),
      },
    });

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text,
      now,
    });

    expect(result.text).toContain(expectedSnippet);
    expect(result.effectiveOrgIds).toEqual(["1001"]);
  });

  it("renders day-by-day detail for range add-clock metric asks before the window summary", async () => {
    const runtime = buildRuntime({
      reports: {
        "1004:2026-03-28": buildReport({
          orgId: "1004",
          storeName: "锦苑店",
          bizDate: "2026-03-28",
          metrics: {
            totalClockCount: 80,
            upClockRecordCount: 75,
            addClockRecordCount: 8,
            addClockRate: 8 / 75,
          },
        }),
        "1004:2026-03-29": buildReport({
          orgId: "1004",
          storeName: "锦苑店",
          bizDate: "2026-03-29",
          metrics: {
            totalClockCount: 92,
            upClockRecordCount: 90,
            addClockRecordCount: 12,
            addClockRate: 12 / 90,
          },
        }),
        "1004:2026-03-30": buildReport({
          orgId: "1004",
          storeName: "锦苑店",
          bizDate: "2026-03-30",
          metrics: {
            totalClockCount: 96,
            upClockRecordCount: 97,
            addClockRecordCount: 12,
            addClockRate: 12 / 97,
          },
        }),
      },
    });

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "锦苑店近3天的加钟数和加钟率",
      now,
    });

    expect(result.text).toContain("锦苑店 近3天 指标查询");
    expect(result.text).toContain("分天明细");
    expect(result.text).toContain("2026-03-28：加钟数量 8 个，加钟率 10.7%（8/75）");
    expect(result.text).toContain("2026-03-29：加钟数量 12 个，加钟率 13.3%（12/90）");
    expect(result.text).toContain("2026-03-30：加钟数量 12 个，加钟率 12.4%（12/97）");
    expect(result.text).toContain("加钟数量: 32 个");
    expect(result.text).toContain("加钟率: 12.2%（32/262）");
  });

  it("uses cached daily report snapshots for range metric asks without rebuilding legacy reports", async () => {
    const runtime = buildRuntime({
      reports: {},
      cachedReports: {
        "1004:2026-03-28": buildReport({
          orgId: "1004",
          storeName: "锦苑店",
          bizDate: "2026-03-28",
          metrics: {
            totalClockCount: 80,
            upClockRecordCount: 75,
            addClockRecordCount: 8,
            addClockRate: 8 / 75,
          },
        }),
        "1004:2026-03-29": buildReport({
          orgId: "1004",
          storeName: "锦苑店",
          bizDate: "2026-03-29",
          metrics: {
            totalClockCount: 92,
            upClockRecordCount: 90,
            addClockRecordCount: 12,
            addClockRate: 12 / 90,
          },
        }),
        "1004:2026-03-30": buildReport({
          orgId: "1004",
          storeName: "锦苑店",
          bizDate: "2026-03-30",
          metrics: {
            totalClockCount: 96,
            upClockRecordCount: 97,
            addClockRecordCount: 12,
            addClockRate: 12 / 97,
          },
        }),
      },
    });

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "锦苑店近3天的加钟数和加钟率",
      now,
    });

    expect(result.text).toContain("锦苑店 近3天 指标查询");
    expect(result.text).toContain("2026-03-28：加钟数量 8 个，加钟率 10.7%（8/75）");
    expect(runtime.getDailyReportSnapshot).toHaveBeenCalledTimes(3);
    expect(runtime.buildReport).not.toHaveBeenCalled();
  });

  it("does not present a fake zero report when a single-day report is incomplete", async () => {
    const runtime = buildRuntime({
      reports: {
        "1001:2026-03-30": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-30",
          complete: false,
          metrics: {
            serviceRevenue: 0,
            totalClockCount: 0,
            incompleteSync: true,
          },
          alerts: [
            {
              code: "data-gap",
              severity: "critical",
              message: "该营业日数据尚未完成同步。",
            },
          ],
        }),
      },
    });

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "义乌店昨天日报",
      now,
    });

    expect(result.text).toContain("义乌店 2026-03-30");
    expect(result.text).toContain("尚未完成同步");
    expect(result.text).not.toContain("义乌店 2026-03-30 日报");
  });

  it("uses daily KPI matview for single-day store report questions", async () => {
    const runtime = buildRuntime({
      reports: {
        "1001:2026-03-30": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-30",
        }),
      },
      dailyKpiRows: {
        "1001:2026-03-30:2026-03-30": [
          {
            bizDate: "2026-03-30",
            orgId: "1001",
            storeName: "义乌店",
            dailyActualRevenue: 24913,
            dailyCardConsume: 4033,
            dailyOrderCount: 59,
            totalClocks: 112,
            assignClocks: 16,
            queueClocks: 76,
            pointClockRate: 0.1429,
            averageTicket: 422.25,
            clockEffect: 222.44,
          },
        ],
      },
    });

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "义乌店昨天经营情况怎么样",
      now,
    });

    expect(result.text).toContain("义乌店 2026-03-30 经营复盘");
    expect(result.text).toContain("实收流水：24913.00 元");
    expect(result.text).toContain("耗卡金额：4033.00 元");
    expect(result.text).toContain("进店单数：59 单");
    expect(result.text).toContain("总上钟数：112.0 个");
    expect(result.text).toContain("门店点钟率：14.3%");
    expect(result.text).toContain("点钟承接偏弱");
    expect(runtime.buildReport).not.toHaveBeenCalled();
  });

  it("treats 前一日 as the day before the default report day", async () => {
    const runtime = buildRuntime({
      reports: {
        "1003:2026-03-29": buildReport({
          orgId: "1003",
          storeName: "华美店",
          bizDate: "2026-03-29",
        }),
      },
      dailyKpiRows: {
        "1003:2026-03-29:2026-03-29": [
          {
            bizDate: "2026-03-29",
            orgId: "1003",
            storeName: "华美店",
            dailyActualRevenue: 18250,
            dailyCardConsume: 2680,
            dailyOrderCount: 46,
            totalClocks: 88,
            assignClocks: 18,
            queueClocks: 58,
            pointClockRate: 0.2045,
            averageTicket: 396.74,
            clockEffect: 207.39,
          },
        ],
      },
    });

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "华美店前一日运营日报",
      now,
    });

    expect(result.text).toContain("华美店 2026-03-29");
    expect(result.text).not.toContain("2026-03-30");
    expect(runtime.buildReport).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "1003",
        bizDate: "2026-03-29",
      }),
    );
  });

  it("answers generic payment-structure phrasing with a payment-share breakdown", async () => {
    const runtime = buildRuntime({
      reports: {
        "1001:2026-03-30": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-30",
        }),
      },
    });

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "义乌店昨天收款方式占比逐个列一下",
      now,
    });

    expect(result.text).toContain("会员消费占比: 65.0%");
    expect(result.text).toContain("现金消费占比: 8.0%");
    expect(result.text).toContain("微信支付占比: 12.0%");
    expect(result.text).toContain("支付宝支付占比: 5.0%");
    expect(result.text).toContain("团购消费占比: 22.5%");
  });

  it("answers grouped payment-amount and groupbuy-platform questions", async () => {
    const runtime = buildRuntime({
      reports: {
        "1001:2026-03-30": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-30",
        }),
      },
    });

    const paymentAmounts = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "义乌店昨天微信和现金分别多少",
      now,
    });
    const platformAmounts = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "义乌店昨天美团和抖音分别多少",
      now,
    });
    const platformShares = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "义乌店昨天团购平台占比分布",
      now,
    });

    expect(paymentAmounts.text).toContain("微信支付金额: 384.00 元");
    expect(paymentAmounts.text).toContain("现金支付金额: 256.00 元");
    expect(platformAmounts.text).toContain("美团团购金额: 560.00 元");
    expect(platformAmounts.text).toContain("抖音团购金额: 160.00 元");
    expect(platformShares.text).toContain("美团团购金额占比: 17.5%");
    expect(platformShares.text).toContain("抖音团购金额占比: 5.0%");
  });

  it("answers add-on revenue phrasing through the existing market revenue metric", async () => {
    const runtime = buildRuntime({
      reports: {
        "1001:2026-03-30": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-30",
        }),
      },
    });

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "义乌店昨天副项卖了多少钱",
      now,
    });

    expect(result.text).toContain("推销营收: 480.00 元");
  });

  it("answers add-on revenue phrasing through the existing market revenue metric", async () => {
    const runtime = buildRuntime({
      reports: {
        "1001:2026-03-30": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-30",
        }),
      },
    });

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "义乌店昨天副项卖了多少钱",
      now,
    });

    expect(result.text).toContain("推销营收: 480.00 元");
  });

  it("answers total-clock composition asks with a concrete breakdown instead of a generic fallback", async () => {
    const runtime = buildRuntime({
      reports: {
        "1001:2026-03-30": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-30",
          metrics: {
            totalClockCount: 136,
            upClockRecordCount: 129,
            pointClockRecordCount: 31,
            pointClockRate: 31 / 129,
            addClockRecordCount: 7,
            addClockRate: 7 / 129,
          },
        }),
      },
      dailyKpiRows: {
        "1001:2026-03-30:2026-03-30": [
          {
            bizDate: "2026-03-30",
            orgId: "1001",
            storeName: "义乌店",
            dailyActualRevenue: 26646,
            dailyCardConsume: 5038,
            dailyOrderCount: 57,
            totalClocks: 136,
            assignClocks: 31,
            queueClocks: 98,
            pointClockRate: 31 / 129,
            averageTicket: 467.47,
            clockEffect: 195.93,
          },
        ],
      },
    });

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "义乌店昨日136个钟，是怎么构成的？",
      now,
    });

    expect(result.text).toContain("义乌店 2026-03-30 钟数构成");
    expect(result.text).toContain("总钟数: 136.0 个");
    expect(result.text).toContain("点钟: 31.0 个");
    expect(result.text).toContain("排钟: 98.0 个");
    expect(result.text).toContain("加钟: 7.0 个");
    expect(result.text).not.toContain("未识别为可执行的门店数据问题");
  });

  it("keeps unsafe clock-composition fallbacks explicit instead of inventing zero point and queue clocks", async () => {
    const runtime = buildRuntime({
      reports: {
        "1001:2026-03-30": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-30",
          metrics: {
            totalClockCount: 136,
            upClockRecordCount: 0,
            pointClockRecordCount: 0,
            pointClockRate: null,
            addClockRecordCount: 22,
            addClockRate: null,
          },
        }),
      },
    });

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "义乌店昨日136个钟，是怎么构成的？",
      now,
    });

    expect(result.text).toContain("义乌店 2026-03-30 钟数构成");
    expect(result.text).toContain("总钟数: 136.0 个");
    expect(result.text).toContain("当前库里只能稳定确认加钟 22.0 个");
    expect(result.text).not.toContain("点钟: 0.0 个");
    expect(result.text).not.toContain("排钟: 0.0 个");
  });

  it("does not trust zeroed daily-kpi breakdown rows as real clock composition", async () => {
    const runtime = buildRuntime({
      reports: {
        "1001:2026-03-30": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-30",
          metrics: {
            totalClockCount: 136,
            upClockRecordCount: 0,
            pointClockRecordCount: 0,
            pointClockRate: null,
            addClockRecordCount: 22,
            addClockRate: null,
          },
        }),
      },
      dailyKpiRows: {
        "1001:2026-03-30:2026-03-30": [
          {
            bizDate: "2026-03-30",
            orgId: "1001",
            storeName: "义乌店",
            dailyActualRevenue: 26646,
            dailyCardConsume: 5038,
            dailyOrderCount: 57,
            totalClocks: 136,
            assignClocks: 0,
            queueClocks: 0,
            pointClockRate: 0,
            averageTicket: 467.47,
            clockEffect: 195.93,
          },
        ],
      },
    });

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "义乌店昨日136个钟，是怎么构成的？",
      now,
    });

    expect(result.text).toContain("当前库里只能稳定确认加钟 22.0 个");
    expect(result.text).not.toContain("点钟: 0.0 个");
    expect(result.text).not.toContain("排钟: 0.0 个");
  });

  it("keeps unsupported utilization-rate queries on the safe side", async () => {
    const runtime = buildRuntime({
      reports: {
        "1001:2026-03-30": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-30",
        }),
      },
    });

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "义乌店昨天上钟率",
      now,
    });

    expect(result.text).toContain("上钟率");
    expect(result.text).toContain("排班可上钟总数");
  });

  it("supports compare, ranking, trend, anomaly, risk, advice, and technician-ranking queries end to end", async () => {
    const runtime = buildRuntime({
      reports: {
        "1001:2026-03-30": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-30",
          metrics: {
            serviceRevenue: 3200,
            totalClockCount: 40,
            clockEffect: 80,
            activeTechCount: 6,
          },
          alerts: [
            { code: "groupbuy-high", severity: "warn", message: "团购占比偏高，需盯二次到店。" },
          ],
          suggestions: ["先把团购客按 7 天未复到店名单单独跟进。"],
        }),
        "1002:2026-03-30": buildReport({
          orgId: "1002",
          storeName: "园中园店",
          bizDate: "2026-03-30",
          metrics: {
            serviceRevenue: 2800,
            totalClockCount: 38,
            clockEffect: 73.68,
            activeTechCount: 5,
          },
        }),
        "1003:2026-03-30": buildReport({
          orgId: "1003",
          storeName: "华美店",
          bizDate: "2026-03-30",
          metrics: {
            serviceRevenue: 3500,
            totalClockCount: 42,
            clockEffect: 83.33,
            activeTechCount: 7,
          },
        }),
        "1004:2026-03-30": buildReport({
          orgId: "1004",
          storeName: "锦苑店",
          bizDate: "2026-03-30",
          metrics: {
            serviceRevenue: 2600,
            totalClockCount: 34,
            clockEffect: 76.47,
            activeTechCount: 5,
          },
        }),
        "1005:2026-03-30": buildReport({
          orgId: "1005",
          storeName: "迎宾店",
          bizDate: "2026-03-30",
          metrics: {
            serviceRevenue: 2100,
            totalClockCount: 28,
            clockEffect: 75,
            activeTechCount: 4,
          },
        }),
        "1001:2026-03-24": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-24",
          metrics: {
            serviceRevenue: 3600,
            totalClockCount: 44,
            clockEffect: 81.82,
            activeTechCount: 7,
          },
        }),
        "1001:2026-03-25": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-25",
          metrics: {
            serviceRevenue: 3500,
            totalClockCount: 43,
            clockEffect: 81.4,
            activeTechCount: 7,
          },
        }),
        "1001:2026-03-26": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-26",
          metrics: {
            serviceRevenue: 3400,
            totalClockCount: 42,
            clockEffect: 80.95,
            activeTechCount: 6,
          },
        }),
        "1001:2026-03-27": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-27",
          metrics: {
            serviceRevenue: 3300,
            totalClockCount: 41,
            clockEffect: 80.49,
            activeTechCount: 6,
          },
        }),
        "1001:2026-03-28": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-28",
          metrics: {
            serviceRevenue: 3250,
            totalClockCount: 40,
            clockEffect: 81.25,
            activeTechCount: 6,
          },
        }),
        "1001:2026-03-29": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-29",
          metrics: {
            serviceRevenue: 3100,
            totalClockCount: 39,
            clockEffect: 79.49,
            activeTechCount: 5,
          },
        }),
        "1001:2026-03-17": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-17",
          metrics: {
            serviceRevenue: 3800,
            totalClockCount: 45,
            clockEffect: 84.44,
            activeTechCount: 7,
          },
        }),
        "1001:2026-03-18": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-18",
          metrics: {
            serviceRevenue: 3750,
            totalClockCount: 45,
            clockEffect: 83.33,
            activeTechCount: 7,
          },
        }),
        "1001:2026-03-19": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-19",
          metrics: {
            serviceRevenue: 3700,
            totalClockCount: 44,
            clockEffect: 84.09,
            activeTechCount: 7,
          },
        }),
        "1001:2026-03-20": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-20",
          metrics: {
            serviceRevenue: 3680,
            totalClockCount: 44,
            clockEffect: 83.64,
            activeTechCount: 7,
          },
        }),
        "1001:2026-03-21": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-21",
          metrics: {
            serviceRevenue: 3620,
            totalClockCount: 43,
            clockEffect: 84.19,
            activeTechCount: 7,
          },
        }),
        "1001:2026-03-22": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-22",
          metrics: {
            serviceRevenue: 3580,
            totalClockCount: 43,
            clockEffect: 83.26,
            activeTechCount: 7,
          },
        }),
        "1001:2026-03-23": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-23",
          metrics: {
            serviceRevenue: 3520,
            totalClockCount: 42,
            clockEffect: 83.81,
            activeTechCount: 7,
          },
        }),
      },
      leaderboard: [
        {
          personCode: "t-1",
          personName: "技师甲",
          totalClockCount: 12,
          upClockRecordCount: 4,
          pointClockRecordCount: 3,
          pointClockRate: 0.75,
          addClockRecordCount: 2,
          addClockRate: 0.5,
          turnover: 960,
          commission: 360,
          commissionRate: 0.375,
          clockEffect: 80,
          marketRevenue: 120,
          marketCommission: 20,
        },
        {
          personCode: "t-2",
          personName: "技师乙",
          totalClockCount: 10,
          upClockRecordCount: 5,
          pointClockRecordCount: 2,
          pointClockRate: 0.4,
          addClockRecordCount: 1,
          addClockRate: 0.2,
          turnover: 800,
          commission: 300,
          commissionRate: 0.375,
          clockEffect: 80,
          marketRevenue: 60,
          marketCommission: 10,
        },
      ],
    });

    const compare = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "义乌店和园中园店昨天营收对比",
      now,
    });
    expect(compare.text).toContain("义乌店 vs 园中园店");
    expect(compare.text).toContain("差额");

    const ranking = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "昨天各店营收排名",
      now,
    });
    expect(ranking.text).toContain("服务营收排名");
    expect(ranking.text).toContain("1. 华美店");

    const reverseRanking = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "昨天各店营收倒数排名",
      now,
    });
    expect(reverseRanking.text).toContain("1. 迎宾店");

    const trend = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "义乌店近7天营收趋势",
      now,
    });
    expect(trend.text).toContain("义乌店 近7天 服务营收趋势");
    expect(trend.text).toContain("2026-03-24");
    expect(trend.text).toContain("2026-03-30");

    const anomaly = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "义乌店近7天营收下滑原因",
      now,
    });
    expect(anomaly.text).toContain("营收异常归因");
    expect(anomaly.text).toContain("主因");
    expect(anomaly.text).toContain("总钟数");

    const riskAdvice = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "义乌店昨天风险和建议",
      now,
    });
    expect(riskAdvice.text).toContain("风险");
    expect(riskAdvice.text).toContain("建议");
    expect(riskAdvice.text).toContain("团购占比偏高");

    const techRanking = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "义乌店昨天技师点钟率排名",
      now,
    });
    expect(techRanking.text).toContain("义乌店 2026-03-30 技师点钟率排名");
    expect(techRanking.text).toContain("1. 技师甲 75.0%");

    const reverseTechRanking = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "义乌店昨天技师点钟率倒数排名",
      now,
    });
    expect(reverseTechRanking.text).toContain("1. 技师乙 40.0%");

    const colloquialTechRanking = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "义乌店哪个技师点钟最高",
      now,
    });
    expect(colloquialTechRanking.text).toContain("义乌店 2026-03-30 技师点钟率排名");
    expect(colloquialTechRanking.text).toContain("1. 技师甲 75.0%");

    const techClockEffectRanking = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "义乌店近30天技师钟效排名",
      now,
    });
    expect(techClockEffectRanking.text).toContain("义乌店 近30天 技师钟效排名");
    expect(techClockEffectRanking.text).toContain("1. 技师甲 80.00 元/钟");

    const colloquialTechEarningRanking = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "义乌店哪个技师最能赚",
      now,
    });
    expect(colloquialTechEarningRanking.text).toContain("义乌店 2026-03-30 技师服务营收排名");

    const colloquialTechEfficiencyRanking = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "义乌店人效最高的技师是谁",
      now,
    });
    expect(colloquialTechEfficiencyRanking.text).toContain("义乌店 2026-03-30 技师钟效排名");
  });

  it("renders weekly store reviews as a boss-facing operating diagnosis instead of a thin metric dump", async () => {
    const runtime = buildRuntime({
      reports: {
        "1001:2026-03-17": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-17",
          metrics: {
            serviceRevenue: 3900,
            totalClockCount: 47,
            clockEffect: 82.98,
            activeTechCount: 7,
            pointClockRate: 0.53,
            addClockRate: 0.3,
            newMembers: 6,
            sleepingMembers: 16,
            sleepingMemberRate: 0.12,
          },
        }),
        "1001:2026-03-18": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-18",
          metrics: {
            serviceRevenue: 3820,
            totalClockCount: 46,
            clockEffect: 83.04,
            activeTechCount: 7,
            pointClockRate: 0.52,
            addClockRate: 0.29,
            newMembers: 6,
            sleepingMembers: 16,
            sleepingMemberRate: 0.12,
          },
        }),
        "1001:2026-03-19": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-19",
          metrics: {
            serviceRevenue: 3760,
            totalClockCount: 45,
            clockEffect: 83.56,
            activeTechCount: 7,
            pointClockRate: 0.51,
            addClockRate: 0.28,
            newMembers: 6,
            sleepingMembers: 17,
            sleepingMemberRate: 0.12,
          },
        }),
        "1001:2026-03-20": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-20",
          metrics: {
            serviceRevenue: 3720,
            totalClockCount: 45,
            clockEffect: 82.67,
            activeTechCount: 7,
            pointClockRate: 0.5,
            addClockRate: 0.29,
            newMembers: 5,
            sleepingMembers: 17,
            sleepingMemberRate: 0.13,
          },
        }),
        "1001:2026-03-21": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-21",
          metrics: {
            serviceRevenue: 3680,
            totalClockCount: 44,
            clockEffect: 83.64,
            activeTechCount: 7,
            pointClockRate: 0.5,
            addClockRate: 0.29,
            newMembers: 5,
            sleepingMembers: 17,
            sleepingMemberRate: 0.13,
          },
        }),
        "1001:2026-03-22": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-22",
          metrics: {
            serviceRevenue: 3600,
            totalClockCount: 43,
            clockEffect: 83.72,
            activeTechCount: 6,
            pointClockRate: 0.49,
            addClockRate: 0.28,
            newMembers: 5,
            sleepingMembers: 18,
            sleepingMemberRate: 0.13,
          },
        }),
        "1001:2026-03-23": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-23",
          metrics: {
            serviceRevenue: 3540,
            totalClockCount: 42,
            clockEffect: 84.29,
            activeTechCount: 6,
            pointClockRate: 0.48,
            addClockRate: 0.27,
            newMembers: 5,
            sleepingMembers: 18,
            sleepingMemberRate: 0.13,
            groupbuyCohortCustomerCount: 6,
            groupbuy7dRevisitCustomerCount: 3,
            groupbuy7dRevisitRate: 0.5,
            groupbuy7dCardOpenedCustomerCount: 2,
            groupbuy7dCardOpenedRate: 2 / 6,
            groupbuy7dStoredValueConvertedCustomerCount: 2,
            groupbuy7dStoredValueConversionRate: 2 / 6,
            groupbuy30dMemberPayConvertedCustomerCount: 2,
            groupbuy30dMemberPayConversionRate: 2 / 6,
            groupbuyFirstOrderCustomerCount: 4,
            groupbuyFirstOrderHighValueMemberCustomerCount: 2,
            groupbuyFirstOrderHighValueMemberRate: 0.5,
          },
        }),
        "1001:2026-03-24": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-24",
          metrics: {
            serviceRevenue: 3600,
            totalClockCount: 44,
            clockEffect: 81.82,
            groupbuyOrderShare: 0.28,
            newMembers: 4,
          },
        }),
        "1001:2026-03-25": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-25",
          metrics: {
            serviceRevenue: 3500,
            totalClockCount: 43,
            clockEffect: 81.4,
            groupbuyOrderShare: 0.27,
            newMembers: 4,
          },
        }),
        "1001:2026-03-26": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-26",
          metrics: {
            serviceRevenue: 3400,
            totalClockCount: 42,
            clockEffect: 80.95,
            groupbuyOrderShare: 0.26,
            newMembers: 5,
          },
        }),
        "1001:2026-03-27": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-27",
          metrics: {
            serviceRevenue: 3300,
            totalClockCount: 41,
            clockEffect: 80.49,
            groupbuyOrderShare: 0.25,
            newMembers: 5,
          },
        }),
        "1001:2026-03-28": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-28",
          metrics: {
            serviceRevenue: 3250,
            totalClockCount: 40,
            clockEffect: 81.25,
            groupbuyOrderShare: 0.24,
            newMembers: 6,
          },
        }),
        "1001:2026-03-29": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-29",
          metrics: {
            serviceRevenue: 3100,
            totalClockCount: 39,
            clockEffect: 79.49,
            groupbuyOrderShare: 0.23,
            newMembers: 6,
          },
        }),
        "1001:2026-03-30": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-30",
          metrics: {
            serviceRevenue: 3200,
            totalClockCount: 40,
            clockEffect: 80,
            activeTechCount: 6,
            pointClockRate: 0.5,
            addClockRate: 0.25,
            newMembers: 5,
            sleepingMembers: 18,
            sleepingMemberRate: 0.15,
            groupbuyCohortCustomerCount: 6,
            groupbuy7dRevisitCustomerCount: 2,
            groupbuy7dRevisitRate: 2 / 6,
            groupbuy7dCardOpenedCustomerCount: 1,
            groupbuy7dCardOpenedRate: 1 / 6,
            groupbuy7dStoredValueConvertedCustomerCount: 1,
            groupbuy7dStoredValueConversionRate: 1 / 6,
            groupbuy30dMemberPayConvertedCustomerCount: 1,
            groupbuy30dMemberPayConversionRate: 1 / 6,
            groupbuyFirstOrderCustomerCount: 4,
            groupbuyFirstOrderHighValueMemberCustomerCount: 1,
            groupbuyFirstOrderHighValueMemberRate: 1 / 4,
          },
          alerts: [
            { code: "groupbuy-high", severity: "warn", message: "团购占比偏高，需盯二次到店。" },
          ],
          suggestions: [
            "先把近7天未复到店团购客单独拉名单，安排今日回访。",
            "晚场补强点钟能力高的技师班次，优先保钟效。",
          ],
        }),
      },
    });

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "义乌店近7天经营复盘",
      now,
    });

    expect(result.text).toContain("义乌店 近7天 经营复盘");
    expect(result.text).toContain("结论摘要");
    expect(result.text).toContain("转化漏斗");
    expect(result.text).toContain("7天复到店率");
    expect(result.text).toContain("7天开卡率");
    expect(result.text).toContain("7天储值转化率");
    expect(result.text).toContain("30天会员消费转化率");
    expect(result.text).toContain("团购首单客转高价值会员率");
    expect(result.text).toContain("上周对比");
    expect(result.text).toContain("较上周");
    expect(result.text).toContain("工作日 vs 周末");
    expect(result.text).toContain("会员经营");
    expect(result.text).toContain("会员侧问题");
    expect(result.text).toContain("技师经营");
    expect(result.text).toContain("技师侧问题");
    expect(result.text).toContain("本周3个必须动作");
  });

  it("prefers the stable 7-day SQL surface for weekly review headline metrics when available", async () => {
    const runtime = buildRuntime({
      reports: {
        "1001:2026-03-23": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-23",
          metrics: { serviceRevenue: 100, totalClockCount: 2, newMembers: 1, activeTechCount: 2 },
        }),
        "1001:2026-03-24": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-24",
          metrics: { serviceRevenue: 100, totalClockCount: 2, newMembers: 1, activeTechCount: 2 },
        }),
        "1001:2026-03-25": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-25",
          metrics: { serviceRevenue: 100, totalClockCount: 2, newMembers: 1, activeTechCount: 2 },
        }),
        "1001:2026-03-26": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-26",
          metrics: { serviceRevenue: 100, totalClockCount: 2, newMembers: 1, activeTechCount: 2 },
        }),
        "1001:2026-03-27": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-27",
          metrics: { serviceRevenue: 100, totalClockCount: 2, newMembers: 1, activeTechCount: 2 },
        }),
        "1001:2026-03-28": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-28",
          metrics: { serviceRevenue: 100, totalClockCount: 2, newMembers: 1, activeTechCount: 2 },
        }),
        "1001:2026-03-29": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-29",
          metrics: {
            serviceRevenue: 100,
            totalClockCount: 2,
            newMembers: 1,
            activeTechCount: 2,
            effectiveMembers: 12,
            sleepingMembers: 3,
            sleepingMemberRate: 0.25,
          },
        }),
        "1001:2026-03-16": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-16",
        }),
        "1001:2026-03-17": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-17",
        }),
        "1001:2026-03-18": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-18",
        }),
        "1001:2026-03-19": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-19",
        }),
        "1001:2026-03-20": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-20",
        }),
        "1001:2026-03-21": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-21",
        }),
        "1001:2026-03-22": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-22",
        }),
      },
      storeReviewRows: {
        "1001:2026-03-29:2026-03-29": [
          {
            orgId: "1001",
            windowEndBizDate: "2026-03-29",
            storeName: "义乌店",
            revenue7d: 10176.9,
            orderCount7d: 101,
            customerCount7d: 101,
            totalClocks7d: 81,
            clockEffect7d: 125.64,
            averageTicket7d: 100.76,
            pointClockRate7d: 0.3343,
            addClockRate7d: 0.074,
            groupbuyOrderShare7d: 0.429,
            groupbuyCohortCustomerCount: 11,
            groupbuy7dRevisitCustomerCount: 10,
            groupbuy7dRevisitRate: 10 / 11,
            groupbuy7dCardOpenedCustomerCount: 0,
            groupbuy7dCardOpenedRate: 0,
            groupbuy7dStoredValueConvertedCustomerCount: 0,
            groupbuy7dStoredValueConversionRate: 0,
            groupbuy30dMemberPayConvertedCustomerCount: 0,
            groupbuy30dMemberPayConversionRate: 0,
            groupbuyFirstOrderCustomerCount: 6,
            groupbuyFirstOrderHighValueMemberCustomerCount: 0,
            groupbuyFirstOrderHighValueMemberRate: 0,
            effectiveMembers: 35,
            sleepingMembers: 0,
            sleepingMemberRate: 0,
            newMembers7d: 28,
            activeTechCount7d: 2.9,
            currentStoredBalance: 1200,
            storedBalanceLifeMonths: 2,
            renewalPressureIndex30d: 1.5,
            memberRepurchaseBaseCustomerCount7d: 4,
            memberRepurchaseReturnedCustomerCount7d: 2,
            memberRepurchaseRate7d: 0.5,
          } as unknown as StoreReview7dRow,
        ],
      },
    });

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config: buildConfig(),
      binding: HQ_BINDING,
      text: "义乌店近7天经营复盘",
      now: new Date("2026-03-30T10:00:00+08:00"),
    });

    expect(result.text).toContain("近7天服务营收 10176.90 元");
    expect(result.text).toContain("门店经营判断: 承压");
    expect(result.text).toContain("当前经营优先级: 先补前台和技师的开卡储值收口，再看高价值沉淀。");
    expect(result.text).toContain("近7天新增会员 28 人，当前有效会员 35 人");
    expect(result.text).toContain("储值寿命 2.0 个月");
    expect(result.text).toContain("续费压力 1.50");
    expect(result.text).toContain("会员7日复购率 50.0%（2/4）");
    expect(result.text).toContain("点钟率只有 33.4%");
  });

  it("prefers the stable 30-day SQL surface for monthly review headline metrics and wording", async () => {
    const reports: Record<string, DailyStoreReport> = {};
    const appendDailyReports = (params: {
      orgId: string;
      storeName: string;
      startDate: string;
      days: number;
      revenue: number;
    }) => {
      const cursor = new Date(`${params.startDate}T00:00:00Z`);
      for (let index = 0; index < params.days; index += 1) {
        const bizDate = cursor.toISOString().slice(0, 10);
        reports[`${params.orgId}:${bizDate}`] = buildReport({
          orgId: params.orgId,
          storeName: params.storeName,
          bizDate,
          metrics: {
            serviceRevenue: params.revenue,
            totalClockCount: 2,
            activeTechCount: 2,
            pointClockRate: 0.3,
            addClockRate: 0.2,
            newMembers: 1,
            effectiveMembers: 10,
            sleepingMembers: 2,
            sleepingMemberRate: 0.2,
            currentStoredBalance: 300,
          },
        });
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    };

    appendDailyReports({
      orgId: "1001",
      storeName: "义乌店",
      startDate: "2026-03-01",
      days: 30,
      revenue: 100,
    });
    appendDailyReports({
      orgId: "1001",
      storeName: "义乌店",
      startDate: "2026-01-30",
      days: 30,
      revenue: 90,
    });

    const runtime = buildRuntime({
      reports,
      storeSummary30dRows: {
        "1001:2026-03-30:2026-03-30": [
          {
            orgId: "1001",
            windowEndBizDate: "2026-03-30",
            storeName: "义乌店",
            revenue30d: 9000,
            orderCount30d: 100,
            customerCount30d: 100,
            totalClocks30d: 120,
            clockEffect30d: 75,
            averageTicket30d: 90,
            pointClockRate30d: 0.42,
            addClockRate30d: 0.26,
            rechargeCash30d: 2400,
            storedConsumeAmount30d: 3600,
            storedConsumeRate30d: 1.5,
            onDutyTechCount30d: 8,
            groupbuyOrderShare30d: 0.36,
            groupbuyCohortCustomerCount: 20,
            groupbuy7dRevisitCustomerCount: 9,
            groupbuy7dRevisitRate: 0.45,
            groupbuy7dCardOpenedCustomerCount: 4,
            groupbuy7dCardOpenedRate: 0.2,
            groupbuy7dStoredValueConvertedCustomerCount: 4,
            groupbuy7dStoredValueConversionRate: 0.2,
            groupbuy30dMemberPayConvertedCustomerCount: 7,
            groupbuy30dMemberPayConversionRate: 0.35,
            groupbuyFirstOrderCustomerCount: 10,
            groupbuyFirstOrderHighValueMemberCustomerCount: 3,
            groupbuyFirstOrderHighValueMemberRate: 0.3,
            effectiveMembers: 88,
            sleepingMembers: 16,
            sleepingMemberRate: 16 / 88,
            newMembers30d: 30,
            activeTechCount30d: 6.8,
            currentStoredBalance: 7200,
            storedBalanceLifeMonths: 2,
            renewalPressureIndex30d: 1.5,
            memberRepurchaseBaseCustomerCount7d: 20,
            memberRepurchaseReturnedCustomerCount7d: 8,
            memberRepurchaseRate7d: 0.4,
          },
        ],
        "1001:2026-02-28:2026-02-28": [
          {
            orgId: "1001",
            windowEndBizDate: "2026-02-28",
            storeName: "义乌店",
            revenue30d: 7800,
            orderCount30d: 96,
            customerCount30d: 96,
            totalClocks30d: 110,
            clockEffect30d: 70.91,
            averageTicket30d: 81.25,
            pointClockRate30d: 0.4,
            addClockRate30d: 0.24,
            rechargeCash30d: 2600,
            storedConsumeAmount30d: 3000,
            storedConsumeRate30d: 1.1538,
            onDutyTechCount30d: 7,
            groupbuyOrderShare30d: 0.33,
            groupbuyCohortCustomerCount: 18,
            groupbuy7dRevisitCustomerCount: 7,
            groupbuy7dRevisitRate: 7 / 18,
            groupbuy7dCardOpenedCustomerCount: 3,
            groupbuy7dCardOpenedRate: 3 / 18,
            groupbuy7dStoredValueConvertedCustomerCount: 3,
            groupbuy7dStoredValueConversionRate: 3 / 18,
            groupbuy30dMemberPayConvertedCustomerCount: 6,
            groupbuy30dMemberPayConversionRate: 6 / 18,
            groupbuyFirstOrderCustomerCount: 9,
            groupbuyFirstOrderHighValueMemberCustomerCount: 2,
            groupbuyFirstOrderHighValueMemberRate: 2 / 9,
            effectiveMembers: 82,
            sleepingMembers: 14,
            sleepingMemberRate: 14 / 82,
            newMembers30d: 24,
            activeTechCount30d: 6.2,
            currentStoredBalance: 8400,
            storedBalanceLifeMonths: 2.8,
            renewalPressureIndex30d: 1.15,
            memberRepurchaseBaseCustomerCount7d: 18,
            memberRepurchaseReturnedCustomerCount7d: 9,
            memberRepurchaseRate7d: 0.5,
          },
        ],
      },
    });

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config: buildConfig(),
      binding: HQ_BINDING,
      text: "义乌店近30天经营复盘",
      now: new Date("2026-03-31T10:00:00+08:00"),
    });

    expect(result.text).toContain("义乌店 近30天 经营复盘");
    expect(result.text).toContain("近30天服务营收 9000.00 元");
    expect(result.text).toContain("上一周期对比");
    expect(result.text).not.toContain("上周对比");
    expect(result.text).toContain("近30天新增会员 30 人，当前有效会员 88 人");
    expect(result.text).toContain("近30天总钟数 120 钟");
    expect(result.text).toContain("储值寿命 2.0 个月");
    expect(result.text).toContain("续费压力 1.50");
  });

  it("answers HQ portfolio questions with fleet summary, rising/dangerous stores, and next-week priorities", async () => {
    const runtime = buildRuntime({
      reports: {
        // Current period (近7天): 2026-03-24 to 2026-03-30
        "1001:2026-03-24": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-24",
          metrics: {
            serviceRevenue: 3600,
            totalClockCount: 44,
            clockEffect: 81.82,
            activeTechCount: 7,
          },
        }),
        "1001:2026-03-25": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-25",
          metrics: {
            serviceRevenue: 3500,
            totalClockCount: 43,
            clockEffect: 81.4,
            activeTechCount: 7,
          },
        }),
        "1001:2026-03-26": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-26",
          metrics: {
            serviceRevenue: 3400,
            totalClockCount: 42,
            clockEffect: 80.95,
            activeTechCount: 6,
          },
        }),
        "1001:2026-03-27": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-27",
          metrics: {
            serviceRevenue: 3300,
            totalClockCount: 41,
            clockEffect: 80.49,
            activeTechCount: 6,
          },
        }),
        "1001:2026-03-28": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-28",
          metrics: {
            serviceRevenue: 3250,
            totalClockCount: 40,
            clockEffect: 81.25,
            activeTechCount: 6,
          },
        }),
        "1001:2026-03-29": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-29",
          metrics: {
            serviceRevenue: 3100,
            totalClockCount: 39,
            clockEffect: 79.49,
            activeTechCount: 5,
          },
        }),
        "1001:2026-03-30": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-30",
          metrics: {
            serviceRevenue: 3200,
            totalClockCount: 40,
            clockEffect: 80,
            activeTechCount: 6,
          },
        }),
        "1002:2026-03-24": buildReport({
          orgId: "1002",
          storeName: "园中园店",
          bizDate: "2026-03-24",
          metrics: {
            serviceRevenue: 2600,
            totalClockCount: 36,
            clockEffect: 72.22,
            activeTechCount: 5,
          },
        }),
        "1002:2026-03-25": buildReport({
          orgId: "1002",
          storeName: "园中园店",
          bizDate: "2026-03-25",
          metrics: {
            serviceRevenue: 2700,
            totalClockCount: 37,
            clockEffect: 72.97,
            activeTechCount: 5,
          },
        }),
        "1002:2026-03-26": buildReport({
          orgId: "1002",
          storeName: "园中园店",
          bizDate: "2026-03-26",
          metrics: {
            serviceRevenue: 2800,
            totalClockCount: 38,
            clockEffect: 73.68,
            activeTechCount: 5,
          },
        }),
        "1002:2026-03-27": buildReport({
          orgId: "1002",
          storeName: "园中园店",
          bizDate: "2026-03-27",
          metrics: {
            serviceRevenue: 2850,
            totalClockCount: 38,
            clockEffect: 75,
            activeTechCount: 5,
          },
        }),
        "1002:2026-03-28": buildReport({
          orgId: "1002",
          storeName: "园中园店",
          bizDate: "2026-03-28",
          metrics: {
            serviceRevenue: 2900,
            totalClockCount: 39,
            clockEffect: 74.36,
            activeTechCount: 5,
            groupbuy7dRevisitRate: 0.5,
            groupbuy7dStoredValueConversionRate: 0.25,
            addClockRate: 0.32,
            sleepingMemberRate: 0.1,
          },
        }),
        "1002:2026-03-29": buildReport({
          orgId: "1002",
          storeName: "园中园店",
          bizDate: "2026-03-29",
          metrics: {
            serviceRevenue: 2950,
            totalClockCount: 39,
            clockEffect: 75.64,
            activeTechCount: 5,
            groupbuy7dRevisitRate: 0.5,
            groupbuy7dStoredValueConversionRate: 0.25,
            addClockRate: 0.32,
            sleepingMemberRate: 0.1,
          },
        }),
        "1002:2026-03-30": buildReport({
          orgId: "1002",
          storeName: "园中园店",
          bizDate: "2026-03-30",
          metrics: {
            serviceRevenue: 3000,
            totalClockCount: 40,
            clockEffect: 75,
            activeTechCount: 5,
            groupbuy7dRevisitRate: 0.5,
            groupbuy7dStoredValueConversionRate: 0.25,
            addClockRate: 0.32,
            sleepingMemberRate: 0.1,
          },
        }),
        "1003:2026-03-24": buildReport({
          orgId: "1003",
          storeName: "华美店",
          bizDate: "2026-03-24",
          metrics: {
            serviceRevenue: 3500,
            totalClockCount: 42,
            clockEffect: 83.33,
            activeTechCount: 7,
          },
        }),
        "1003:2026-03-25": buildReport({
          orgId: "1003",
          storeName: "华美店",
          bizDate: "2026-03-25",
          metrics: {
            serviceRevenue: 3500,
            totalClockCount: 42,
            clockEffect: 83.33,
            activeTechCount: 7,
          },
        }),
        "1003:2026-03-26": buildReport({
          orgId: "1003",
          storeName: "华美店",
          bizDate: "2026-03-26",
          metrics: {
            serviceRevenue: 3500,
            totalClockCount: 42,
            clockEffect: 83.33,
            activeTechCount: 7,
          },
        }),
        "1003:2026-03-27": buildReport({
          orgId: "1003",
          storeName: "华美店",
          bizDate: "2026-03-27",
          metrics: {
            serviceRevenue: 3500,
            totalClockCount: 42,
            clockEffect: 83.33,
            activeTechCount: 7,
          },
        }),
        "1003:2026-03-28": buildReport({
          orgId: "1003",
          storeName: "华美店",
          bizDate: "2026-03-28",
          metrics: {
            serviceRevenue: 3500,
            totalClockCount: 42,
            clockEffect: 83.33,
            activeTechCount: 7,
          },
        }),
        "1003:2026-03-29": buildReport({
          orgId: "1003",
          storeName: "华美店",
          bizDate: "2026-03-29",
          metrics: {
            serviceRevenue: 3500,
            totalClockCount: 42,
            clockEffect: 83.33,
            activeTechCount: 7,
          },
        }),
        "1003:2026-03-30": buildReport({
          orgId: "1003",
          storeName: "华美店",
          bizDate: "2026-03-30",
          metrics: {
            serviceRevenue: 3500,
            totalClockCount: 42,
            clockEffect: 83.33,
            activeTechCount: 7,
          },
        }),
        "1004:2026-03-24": buildReport({
          orgId: "1004",
          storeName: "锦苑店",
          bizDate: "2026-03-24",
          metrics: {
            serviceRevenue: 2800,
            totalClockCount: 34,
            clockEffect: 82.35,
            activeTechCount: 5,
          },
        }),
        "1004:2026-03-25": buildReport({
          orgId: "1004",
          storeName: "锦苑店",
          bizDate: "2026-03-25",
          metrics: {
            serviceRevenue: 2700,
            totalClockCount: 33,
            clockEffect: 81.82,
            activeTechCount: 5,
          },
        }),
        "1004:2026-03-26": buildReport({
          orgId: "1004",
          storeName: "锦苑店",
          bizDate: "2026-03-26",
          metrics: {
            serviceRevenue: 2600,
            totalClockCount: 32,
            clockEffect: 81.25,
            activeTechCount: 5,
          },
        }),
        "1004:2026-03-27": buildReport({
          orgId: "1004",
          storeName: "锦苑店",
          bizDate: "2026-03-27",
          metrics: {
            serviceRevenue: 2500,
            totalClockCount: 31,
            clockEffect: 80.65,
            activeTechCount: 4,
          },
        }),
        "1004:2026-03-28": buildReport({
          orgId: "1004",
          storeName: "锦苑店",
          bizDate: "2026-03-28",
          metrics: {
            serviceRevenue: 2400,
            totalClockCount: 30,
            clockEffect: 80,
            activeTechCount: 4,
            groupbuy7dRevisitRate: 0.28,
            groupbuy7dStoredValueConversionRate: 0.12,
            addClockRate: 0.22,
            sleepingMemberRate: 0.2,
          },
        }),
        "1004:2026-03-29": buildReport({
          orgId: "1004",
          storeName: "锦苑店",
          bizDate: "2026-03-29",
          metrics: {
            serviceRevenue: 2300,
            totalClockCount: 29,
            clockEffect: 79.31,
            activeTechCount: 4,
            groupbuy7dRevisitRate: 0.28,
            groupbuy7dStoredValueConversionRate: 0.12,
            addClockRate: 0.22,
            sleepingMemberRate: 0.2,
          },
        }),
        "1004:2026-03-30": buildReport({
          orgId: "1004",
          storeName: "锦苑店",
          bizDate: "2026-03-30",
          metrics: {
            serviceRevenue: 2200,
            totalClockCount: 28,
            clockEffect: 78.57,
            activeTechCount: 4,
            groupbuy7dRevisitRate: 0.28,
            groupbuy7dStoredValueConversionRate: 0.12,
            addClockRate: 0.22,
            sleepingMemberRate: 0.2,
          },
          alerts: [{ code: "revenue-drop", severity: "critical", message: "营收连续下滑。" }],
        }),
        "1005:2026-03-24": buildReport({
          orgId: "1005",
          storeName: "迎宾店",
          bizDate: "2026-03-24",
          metrics: {
            serviceRevenue: 2100,
            totalClockCount: 28,
            clockEffect: 75,
            activeTechCount: 4,
          },
        }),
        "1005:2026-03-25": buildReport({
          orgId: "1005",
          storeName: "迎宾店",
          bizDate: "2026-03-25",
          metrics: {
            serviceRevenue: 2100,
            totalClockCount: 28,
            clockEffect: 75,
            activeTechCount: 4,
          },
        }),
        "1005:2026-03-26": buildReport({
          orgId: "1005",
          storeName: "迎宾店",
          bizDate: "2026-03-26",
          metrics: {
            serviceRevenue: 2100,
            totalClockCount: 28,
            clockEffect: 75,
            activeTechCount: 4,
          },
        }),
        "1005:2026-03-27": buildReport({
          orgId: "1005",
          storeName: "迎宾店",
          bizDate: "2026-03-27",
          metrics: {
            serviceRevenue: 2100,
            totalClockCount: 28,
            clockEffect: 75,
            activeTechCount: 4,
          },
        }),
        "1005:2026-03-28": buildReport({
          orgId: "1005",
          storeName: "迎宾店",
          bizDate: "2026-03-28",
          metrics: {
            serviceRevenue: 2100,
            totalClockCount: 28,
            clockEffect: 75,
            activeTechCount: 4,
          },
        }),
        "1005:2026-03-29": buildReport({
          orgId: "1005",
          storeName: "迎宾店",
          bizDate: "2026-03-29",
          metrics: {
            serviceRevenue: 2100,
            totalClockCount: 28,
            clockEffect: 75,
            activeTechCount: 4,
          },
        }),
        "1005:2026-03-30": buildReport({
          orgId: "1005",
          storeName: "迎宾店",
          bizDate: "2026-03-30",
          metrics: {
            serviceRevenue: 2100,
            totalClockCount: 28,
            clockEffect: 75,
            activeTechCount: 4,
          },
        }),
        // Previous period (上7天): 2026-03-17 to 2026-03-23
        "1001:2026-03-17": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-17",
          metrics: {
            serviceRevenue: 3400,
            totalClockCount: 42,
            clockEffect: 80.95,
            activeTechCount: 7,
          },
        }),
        "1001:2026-03-18": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-18",
          metrics: {
            serviceRevenue: 3400,
            totalClockCount: 42,
            clockEffect: 80.95,
            activeTechCount: 7,
          },
        }),
        "1001:2026-03-19": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-19",
          metrics: {
            serviceRevenue: 3400,
            totalClockCount: 42,
            clockEffect: 80.95,
            activeTechCount: 7,
          },
        }),
        "1001:2026-03-20": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-20",
          metrics: {
            serviceRevenue: 3400,
            totalClockCount: 42,
            clockEffect: 80.95,
            activeTechCount: 7,
          },
        }),
        "1001:2026-03-21": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-21",
          metrics: {
            serviceRevenue: 3400,
            totalClockCount: 42,
            clockEffect: 80.95,
            activeTechCount: 7,
          },
        }),
        "1001:2026-03-22": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-22",
          metrics: {
            serviceRevenue: 3400,
            totalClockCount: 42,
            clockEffect: 80.95,
            activeTechCount: 7,
          },
        }),
        "1001:2026-03-23": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-23",
          metrics: {
            serviceRevenue: 3400,
            totalClockCount: 42,
            clockEffect: 80.95,
            activeTechCount: 7,
          },
        }),
        "1002:2026-03-17": buildReport({
          orgId: "1002",
          storeName: "园中园店",
          bizDate: "2026-03-17",
          metrics: {
            serviceRevenue: 2500,
            totalClockCount: 34,
            clockEffect: 73.53,
            activeTechCount: 5,
          },
        }),
        "1002:2026-03-18": buildReport({
          orgId: "1002",
          storeName: "园中园店",
          bizDate: "2026-03-18",
          metrics: {
            serviceRevenue: 2500,
            totalClockCount: 34,
            clockEffect: 73.53,
            activeTechCount: 5,
          },
        }),
        "1002:2026-03-19": buildReport({
          orgId: "1002",
          storeName: "园中园店",
          bizDate: "2026-03-19",
          metrics: {
            serviceRevenue: 2500,
            totalClockCount: 34,
            clockEffect: 73.53,
            activeTechCount: 5,
          },
        }),
        "1002:2026-03-20": buildReport({
          orgId: "1002",
          storeName: "园中园店",
          bizDate: "2026-03-20",
          metrics: {
            serviceRevenue: 2500,
            totalClockCount: 34,
            clockEffect: 73.53,
            activeTechCount: 5,
          },
        }),
        "1002:2026-03-21": buildReport({
          orgId: "1002",
          storeName: "园中园店",
          bizDate: "2026-03-21",
          metrics: {
            serviceRevenue: 2500,
            totalClockCount: 34,
            clockEffect: 73.53,
            activeTechCount: 5,
          },
        }),
        "1002:2026-03-22": buildReport({
          orgId: "1002",
          storeName: "园中园店",
          bizDate: "2026-03-22",
          metrics: {
            serviceRevenue: 2500,
            totalClockCount: 34,
            clockEffect: 73.53,
            activeTechCount: 5,
          },
        }),
        "1002:2026-03-23": buildReport({
          orgId: "1002",
          storeName: "园中园店",
          bizDate: "2026-03-23",
          metrics: {
            serviceRevenue: 2500,
            totalClockCount: 34,
            clockEffect: 73.53,
            activeTechCount: 5,
          },
        }),
        "1003:2026-03-17": buildReport({
          orgId: "1003",
          storeName: "华美店",
          bizDate: "2026-03-17",
          metrics: {
            serviceRevenue: 3500,
            totalClockCount: 42,
            clockEffect: 83.33,
            activeTechCount: 7,
          },
        }),
        "1003:2026-03-18": buildReport({
          orgId: "1003",
          storeName: "华美店",
          bizDate: "2026-03-18",
          metrics: {
            serviceRevenue: 3500,
            totalClockCount: 42,
            clockEffect: 83.33,
            activeTechCount: 7,
          },
        }),
        "1003:2026-03-19": buildReport({
          orgId: "1003",
          storeName: "华美店",
          bizDate: "2026-03-19",
          metrics: {
            serviceRevenue: 3500,
            totalClockCount: 42,
            clockEffect: 83.33,
            activeTechCount: 7,
          },
        }),
        "1003:2026-03-20": buildReport({
          orgId: "1003",
          storeName: "华美店",
          bizDate: "2026-03-20",
          metrics: {
            serviceRevenue: 3500,
            totalClockCount: 42,
            clockEffect: 83.33,
            activeTechCount: 7,
          },
        }),
        "1003:2026-03-21": buildReport({
          orgId: "1003",
          storeName: "华美店",
          bizDate: "2026-03-21",
          metrics: {
            serviceRevenue: 3500,
            totalClockCount: 42,
            clockEffect: 83.33,
            activeTechCount: 7,
          },
        }),
        "1003:2026-03-22": buildReport({
          orgId: "1003",
          storeName: "华美店",
          bizDate: "2026-03-22",
          metrics: {
            serviceRevenue: 3500,
            totalClockCount: 42,
            clockEffect: 83.33,
            activeTechCount: 7,
          },
        }),
        "1003:2026-03-23": buildReport({
          orgId: "1003",
          storeName: "华美店",
          bizDate: "2026-03-23",
          metrics: {
            serviceRevenue: 3500,
            totalClockCount: 42,
            clockEffect: 83.33,
            activeTechCount: 7,
          },
        }),
        "1004:2026-03-17": buildReport({
          orgId: "1004",
          storeName: "锦苑店",
          bizDate: "2026-03-17",
          metrics: {
            serviceRevenue: 2900,
            totalClockCount: 35,
            clockEffect: 82.86,
            activeTechCount: 5,
          },
        }),
        "1004:2026-03-18": buildReport({
          orgId: "1004",
          storeName: "锦苑店",
          bizDate: "2026-03-18",
          metrics: {
            serviceRevenue: 2900,
            totalClockCount: 35,
            clockEffect: 82.86,
            activeTechCount: 5,
          },
        }),
        "1004:2026-03-19": buildReport({
          orgId: "1004",
          storeName: "锦苑店",
          bizDate: "2026-03-19",
          metrics: {
            serviceRevenue: 2900,
            totalClockCount: 35,
            clockEffect: 82.86,
            activeTechCount: 5,
          },
        }),
        "1004:2026-03-20": buildReport({
          orgId: "1004",
          storeName: "锦苑店",
          bizDate: "2026-03-20",
          metrics: {
            serviceRevenue: 2900,
            totalClockCount: 35,
            clockEffect: 82.86,
            activeTechCount: 5,
          },
        }),
        "1004:2026-03-21": buildReport({
          orgId: "1004",
          storeName: "锦苑店",
          bizDate: "2026-03-21",
          metrics: {
            serviceRevenue: 2900,
            totalClockCount: 35,
            clockEffect: 82.86,
            activeTechCount: 5,
          },
        }),
        "1004:2026-03-22": buildReport({
          orgId: "1004",
          storeName: "锦苑店",
          bizDate: "2026-03-22",
          metrics: {
            serviceRevenue: 2900,
            totalClockCount: 35,
            clockEffect: 82.86,
            activeTechCount: 5,
          },
        }),
        "1004:2026-03-23": buildReport({
          orgId: "1004",
          storeName: "锦苑店",
          bizDate: "2026-03-23",
          metrics: {
            serviceRevenue: 2900,
            totalClockCount: 35,
            clockEffect: 82.86,
            activeTechCount: 5,
          },
        }),
        "1005:2026-03-17": buildReport({
          orgId: "1005",
          storeName: "迎宾店",
          bizDate: "2026-03-17",
          metrics: {
            serviceRevenue: 2100,
            totalClockCount: 28,
            clockEffect: 75,
            activeTechCount: 4,
          },
        }),
        "1005:2026-03-18": buildReport({
          orgId: "1005",
          storeName: "迎宾店",
          bizDate: "2026-03-18",
          metrics: {
            serviceRevenue: 2100,
            totalClockCount: 28,
            clockEffect: 75,
            activeTechCount: 4,
          },
        }),
        "1005:2026-03-19": buildReport({
          orgId: "1005",
          storeName: "迎宾店",
          bizDate: "2026-03-19",
          metrics: {
            serviceRevenue: 2100,
            totalClockCount: 28,
            clockEffect: 75,
            activeTechCount: 4,
          },
        }),
        "1005:2026-03-20": buildReport({
          orgId: "1005",
          storeName: "迎宾店",
          bizDate: "2026-03-20",
          metrics: {
            serviceRevenue: 2100,
            totalClockCount: 28,
            clockEffect: 75,
            activeTechCount: 4,
          },
        }),
        "1005:2026-03-21": buildReport({
          orgId: "1005",
          storeName: "迎宾店",
          bizDate: "2026-03-21",
          metrics: {
            serviceRevenue: 2100,
            totalClockCount: 28,
            clockEffect: 75,
            activeTechCount: 4,
          },
        }),
        "1005:2026-03-22": buildReport({
          orgId: "1005",
          storeName: "迎宾店",
          bizDate: "2026-03-22",
          metrics: {
            serviceRevenue: 2100,
            totalClockCount: 28,
            clockEffect: 75,
            activeTechCount: 4,
          },
        }),
        "1005:2026-03-23": buildReport({
          orgId: "1005",
          storeName: "迎宾店",
          bizDate: "2026-03-23",
          metrics: {
            serviceRevenue: 2100,
            totalClockCount: 28,
            clockEffect: 75,
            activeTechCount: 4,
          },
        }),
      },
    });

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "近7天五个店整体怎么样，哪家在拉升，哪家最危险，下周总部先抓什么",
      now,
    });

    // Structure assertions
    expect(result.text).toContain("总部经营全景");
    expect(result.text).toContain("整体概览");
    expect(result.text).toContain("营收排名");
    expect(result.text).toContain("拉升门店");
    expect(result.text).toContain("增长质量");
    expect(result.text).toContain("最危险门店");
    expect(result.text).toContain("各店风险排序");
    expect(result.text).toContain("经营状态");
    expect(result.text).toContain("下周总部优先动作");

    // CMO/CGO metrics in fleet summary
    expect(result.text).toContain("综合客单价");
    expect(result.text).toContain("新增会员合计");
    expect(result.text).toContain("储值耗卡比");

    // Per-store metrics in revenue ranking
    expect(result.text).toContain("客单价");
    expect(result.text).toContain("人效");

    // Content assertions: garden store is rising (revenue went up)
    expect(result.text).toContain("园中园店");
    expect(result.text).toContain("拉升");

    // Content assertions: jinyuan store is most dangerous (revenue dropping, high sleeping rate, low revisit)
    expect(result.text).toContain("锦苑店");
    expect(result.text).toContain("风险分");

    // Should cover all 5 stores
    expect(result.effectiveOrgIds).toHaveLength(5);
  });

  it("prefers stable 30-day summary rows for HQ monthly portfolio cash-pool and danger signals", async () => {
    const reports: Record<string, DailyStoreReport> = {};
    const stores = [
      { orgId: "1001", storeName: "义乌店", revenue: 120 },
      { orgId: "1002", storeName: "园中园店", revenue: 150 },
      { orgId: "1003", storeName: "华美店", revenue: 110 },
      { orgId: "1004", storeName: "锦苑店", revenue: 80 },
      { orgId: "1005", storeName: "迎宾店", revenue: 180 },
    ];
    const appendDailyReports = (params: {
      orgId: string;
      storeName: string;
      startDate: string;
      days: number;
      revenue: number;
    }) => {
      const cursor = new Date(`${params.startDate}T00:00:00Z`);
      for (let index = 0; index < params.days; index += 1) {
        const bizDate = cursor.toISOString().slice(0, 10);
        reports[`${params.orgId}:${bizDate}`] = buildReport({
          orgId: params.orgId,
          storeName: params.storeName,
          bizDate,
          metrics: {
            serviceRevenue: params.revenue,
            totalClockCount: 2,
            activeTechCount: 2,
            pointClockRate: 0.35,
            addClockRate: 0.22,
            newMembers: 1,
            effectiveMembers: 12,
            sleepingMembers: 2,
            sleepingMemberRate: 2 / 12,
            currentStoredBalance: 300,
          },
        });
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    };

    for (const store of stores) {
      appendDailyReports({
        ...store,
        startDate: "2026-03-01",
        days: 30,
      });
      appendDailyReports({
        ...store,
        startDate: "2026-01-30",
        days: 30,
        revenue: Math.max(60, store.revenue - 10),
      });
    }

    const runtime = buildRuntime({
      reports,
      storeSummary30dRows: {
        "1001:2026-03-30:2026-03-30": [
          {
            orgId: "1001",
            windowEndBizDate: "2026-03-30",
            storeName: "义乌店",
            revenue30d: 9800,
            orderCount30d: 102,
            customerCount30d: 102,
            totalClocks30d: 126,
            clockEffect30d: 77.78,
            averageTicket30d: 96.08,
            pointClockRate30d: 0.43,
            addClockRate30d: 0.29,
            rechargeCash30d: 2600,
            storedConsumeAmount30d: 2900,
            storedConsumeRate30d: 1.1154,
            onDutyTechCount30d: 7.5,
            groupbuyOrderShare30d: 0.34,
            groupbuyCohortCustomerCount: 18,
            groupbuy7dRevisitCustomerCount: 8,
            groupbuy7dRevisitRate: 8 / 18,
            groupbuy7dCardOpenedCustomerCount: 4,
            groupbuy7dCardOpenedRate: 4 / 18,
            groupbuy7dStoredValueConvertedCustomerCount: 4,
            groupbuy7dStoredValueConversionRate: 4 / 18,
            groupbuy30dMemberPayConvertedCustomerCount: 7,
            groupbuy30dMemberPayConversionRate: 7 / 18,
            groupbuyFirstOrderCustomerCount: 10,
            groupbuyFirstOrderHighValueMemberCustomerCount: 3,
            groupbuyFirstOrderHighValueMemberRate: 0.3,
            effectiveMembers: 95,
            sleepingMembers: 10,
            sleepingMemberRate: 10 / 95,
            newMembers30d: 28,
            activeTechCount30d: 6.4,
            currentStoredBalance: 3000,
            storedBalanceLifeMonths: 3.1,
            renewalPressureIndex30d: 1.12,
            memberRepurchaseBaseCustomerCount7d: 14,
            memberRepurchaseReturnedCustomerCount7d: 7,
            memberRepurchaseRate7d: 0.5,
          },
        ],
        "1002:2026-03-30:2026-03-30": [
          {
            orgId: "1002",
            windowEndBizDate: "2026-03-30",
            storeName: "园中园店",
            revenue30d: 10800,
            orderCount30d: 108,
            customerCount30d: 108,
            totalClocks30d: 132,
            clockEffect30d: 81.82,
            averageTicket30d: 100,
            pointClockRate30d: 0.46,
            addClockRate30d: 0.31,
            rechargeCash30d: 3000,
            storedConsumeAmount30d: 2850,
            storedConsumeRate30d: 0.95,
            onDutyTechCount30d: 8,
            groupbuyOrderShare30d: 0.3,
            groupbuyCohortCustomerCount: 20,
            groupbuy7dRevisitCustomerCount: 10,
            groupbuy7dRevisitRate: 0.5,
            groupbuy7dCardOpenedCustomerCount: 5,
            groupbuy7dCardOpenedRate: 0.25,
            groupbuy7dStoredValueConvertedCustomerCount: 5,
            groupbuy7dStoredValueConversionRate: 0.25,
            groupbuy30dMemberPayConvertedCustomerCount: 8,
            groupbuy30dMemberPayConversionRate: 0.4,
            groupbuyFirstOrderCustomerCount: 10,
            groupbuyFirstOrderHighValueMemberCustomerCount: 4,
            groupbuyFirstOrderHighValueMemberRate: 0.4,
            effectiveMembers: 98,
            sleepingMembers: 9,
            sleepingMemberRate: 9 / 98,
            newMembers30d: 32,
            activeTechCount30d: 6.8,
            currentStoredBalance: 4500,
            storedBalanceLifeMonths: 4.7,
            renewalPressureIndex30d: 0.95,
            memberRepurchaseBaseCustomerCount7d: 16,
            memberRepurchaseReturnedCustomerCount7d: 9,
            memberRepurchaseRate7d: 0.5625,
          },
        ],
        "1003:2026-03-30:2026-03-30": [
          {
            orgId: "1003",
            windowEndBizDate: "2026-03-30",
            storeName: "华美店",
            revenue30d: 9200,
            orderCount30d: 97,
            customerCount30d: 97,
            totalClocks30d: 118,
            clockEffect30d: 77.97,
            averageTicket30d: 94.85,
            pointClockRate30d: 0.41,
            addClockRate30d: 0.27,
            rechargeCash30d: 2200,
            storedConsumeAmount30d: 2400,
            storedConsumeRate30d: 1.0909,
            onDutyTechCount30d: 7,
            groupbuyOrderShare30d: 0.32,
            groupbuyCohortCustomerCount: 17,
            groupbuy7dRevisitCustomerCount: 7,
            groupbuy7dRevisitRate: 7 / 17,
            groupbuy7dCardOpenedCustomerCount: 3,
            groupbuy7dCardOpenedRate: 3 / 17,
            groupbuy7dStoredValueConvertedCustomerCount: 3,
            groupbuy7dStoredValueConversionRate: 3 / 17,
            groupbuy30dMemberPayConvertedCustomerCount: 6,
            groupbuy30dMemberPayConversionRate: 6 / 17,
            groupbuyFirstOrderCustomerCount: 10,
            groupbuyFirstOrderHighValueMemberCustomerCount: 2,
            groupbuyFirstOrderHighValueMemberRate: 0.2,
            effectiveMembers: 90,
            sleepingMembers: 12,
            sleepingMemberRate: 12 / 90,
            newMembers30d: 24,
            activeTechCount30d: 6.1,
            currentStoredBalance: 2500,
            storedBalanceLifeMonths: 3.1,
            renewalPressureIndex30d: 1.09,
            memberRepurchaseBaseCustomerCount7d: 15,
            memberRepurchaseReturnedCustomerCount7d: 6,
            memberRepurchaseRate7d: 0.4,
          },
        ],
        "1004:2026-03-30:2026-03-30": [
          {
            orgId: "1004",
            windowEndBizDate: "2026-03-30",
            storeName: "锦苑店",
            revenue30d: 7600,
            orderCount30d: 90,
            customerCount30d: 90,
            totalClocks30d: 110,
            clockEffect30d: 69.09,
            averageTicket30d: 84.44,
            pointClockRate30d: 0.34,
            addClockRate30d: 0.18,
            rechargeCash30d: 1500,
            storedConsumeAmount30d: 2700,
            storedConsumeRate30d: 1.8,
            onDutyTechCount30d: 6,
            groupbuyOrderShare30d: 0.41,
            groupbuyCohortCustomerCount: 15,
            groupbuy7dRevisitCustomerCount: 4,
            groupbuy7dRevisitRate: 4 / 15,
            groupbuy7dCardOpenedCustomerCount: 2,
            groupbuy7dCardOpenedRate: 2 / 15,
            groupbuy7dStoredValueConvertedCustomerCount: 2,
            groupbuy7dStoredValueConversionRate: 2 / 15,
            groupbuy30dMemberPayConvertedCustomerCount: 4,
            groupbuy30dMemberPayConversionRate: 4 / 15,
            groupbuyFirstOrderCustomerCount: 10,
            groupbuyFirstOrderHighValueMemberCustomerCount: 1,
            groupbuyFirstOrderHighValueMemberRate: 0.1,
            effectiveMembers: 70,
            sleepingMembers: 18,
            sleepingMemberRate: 18 / 70,
            newMembers30d: 14,
            activeTechCount30d: 5.2,
            currentStoredBalance: 1500,
            storedBalanceLifeMonths: 1.4,
            renewalPressureIndex30d: 1.8,
            memberRepurchaseBaseCustomerCount7d: 8,
            memberRepurchaseReturnedCustomerCount7d: 2,
            memberRepurchaseRate7d: 0.25,
          },
        ],
        "1005:2026-03-30:2026-03-30": [
          {
            orgId: "1005",
            windowEndBizDate: "2026-03-30",
            storeName: "迎宾店",
            revenue30d: 11800,
            orderCount30d: 115,
            customerCount30d: 115,
            totalClocks30d: 145,
            clockEffect30d: 81.38,
            averageTicket30d: 102.61,
            pointClockRate30d: 0.48,
            addClockRate30d: 0.33,
            rechargeCash30d: 3200,
            storedConsumeAmount30d: 3000,
            storedConsumeRate30d: 0.9375,
            onDutyTechCount30d: 8.4,
            groupbuyOrderShare30d: 0.28,
            groupbuyCohortCustomerCount: 22,
            groupbuy7dRevisitCustomerCount: 11,
            groupbuy7dRevisitRate: 0.5,
            groupbuy7dCardOpenedCustomerCount: 6,
            groupbuy7dCardOpenedRate: 6 / 22,
            groupbuy7dStoredValueConvertedCustomerCount: 6,
            groupbuy7dStoredValueConversionRate: 6 / 22,
            groupbuy30dMemberPayConvertedCustomerCount: 9,
            groupbuy30dMemberPayConversionRate: 9 / 22,
            groupbuyFirstOrderCustomerCount: 10,
            groupbuyFirstOrderHighValueMemberCustomerCount: 4,
            groupbuyFirstOrderHighValueMemberRate: 0.4,
            effectiveMembers: 104,
            sleepingMembers: 8,
            sleepingMemberRate: 8 / 104,
            newMembers30d: 34,
            activeTechCount30d: 7.1,
            currentStoredBalance: 8000,
            storedBalanceLifeMonths: 8,
            renewalPressureIndex30d: 0.94,
            memberRepurchaseBaseCustomerCount7d: 18,
            memberRepurchaseReturnedCustomerCount7d: 11,
            memberRepurchaseRate7d: 11 / 18,
          },
        ],
        "1001:2026-02-28:2026-02-28": [
          {
            orgId: "1001",
            windowEndBizDate: "2026-02-28",
            storeName: "义乌店",
            revenue30d: 9100,
            orderCount30d: 98,
            customerCount30d: 98,
            totalClocks30d: 122,
            clockEffect30d: 74.59,
            averageTicket30d: 92.86,
            pointClockRate30d: 0.41,
            addClockRate30d: 0.27,
            rechargeCash30d: 2550,
            storedConsumeAmount30d: 2800,
            storedConsumeRate30d: 1.098,
            onDutyTechCount30d: 7.2,
            groupbuyOrderShare30d: 0.34,
            groupbuyCohortCustomerCount: 18,
            groupbuy7dRevisitCustomerCount: 7,
            groupbuy7dRevisitRate: 7 / 18,
            groupbuy7dCardOpenedCustomerCount: 3,
            groupbuy7dCardOpenedRate: 3 / 18,
            groupbuy7dStoredValueConvertedCustomerCount: 3,
            groupbuy7dStoredValueConversionRate: 3 / 18,
            groupbuy30dMemberPayConvertedCustomerCount: 6,
            groupbuy30dMemberPayConversionRate: 6 / 18,
            groupbuyFirstOrderCustomerCount: 10,
            groupbuyFirstOrderHighValueMemberCustomerCount: 2,
            groupbuyFirstOrderHighValueMemberRate: 0.2,
            effectiveMembers: 92,
            sleepingMembers: 11,
            sleepingMemberRate: 11 / 92,
            newMembers30d: 24,
            activeTechCount30d: 6,
            currentStoredBalance: 3200,
            storedBalanceLifeMonths: 3.4,
            renewalPressureIndex30d: 1.1,
            memberRepurchaseBaseCustomerCount7d: 14,
            memberRepurchaseReturnedCustomerCount7d: 6,
            memberRepurchaseRate7d: 6 / 14,
          },
        ],
        "1002:2026-02-28:2026-02-28": [
          {
            orgId: "1002",
            windowEndBizDate: "2026-02-28",
            storeName: "园中园店",
            revenue30d: 9600,
            orderCount30d: 100,
            customerCount30d: 100,
            totalClocks30d: 126,
            clockEffect30d: 76.19,
            averageTicket30d: 96,
            pointClockRate30d: 0.44,
            addClockRate30d: 0.29,
            rechargeCash30d: 2950,
            storedConsumeAmount30d: 2800,
            storedConsumeRate30d: 0.9492,
            onDutyTechCount30d: 7.8,
            groupbuyOrderShare30d: 0.31,
            groupbuyCohortCustomerCount: 18,
            groupbuy7dRevisitCustomerCount: 8,
            groupbuy7dRevisitRate: 8 / 18,
            groupbuy7dCardOpenedCustomerCount: 4,
            groupbuy7dCardOpenedRate: 4 / 18,
            groupbuy7dStoredValueConvertedCustomerCount: 4,
            groupbuy7dStoredValueConversionRate: 4 / 18,
            groupbuy30dMemberPayConvertedCustomerCount: 7,
            groupbuy30dMemberPayConversionRate: 7 / 18,
            groupbuyFirstOrderCustomerCount: 10,
            groupbuyFirstOrderHighValueMemberCustomerCount: 3,
            groupbuyFirstOrderHighValueMemberRate: 0.3,
            effectiveMembers: 94,
            sleepingMembers: 10,
            sleepingMemberRate: 10 / 94,
            newMembers30d: 26,
            activeTechCount30d: 6.4,
            currentStoredBalance: 4300,
            storedBalanceLifeMonths: 4.6,
            renewalPressureIndex30d: 0.93,
            memberRepurchaseBaseCustomerCount7d: 15,
            memberRepurchaseReturnedCustomerCount7d: 8,
            memberRepurchaseRate7d: 8 / 15,
          },
        ],
        "1003:2026-02-28:2026-02-28": [
          {
            orgId: "1003",
            windowEndBizDate: "2026-02-28",
            storeName: "华美店",
            revenue30d: 8900,
            orderCount30d: 94,
            customerCount30d: 94,
            totalClocks30d: 116,
            clockEffect30d: 76.72,
            averageTicket30d: 94.68,
            pointClockRate30d: 0.4,
            addClockRate30d: 0.26,
            rechargeCash30d: 2150,
            storedConsumeAmount30d: 2300,
            storedConsumeRate30d: 1.0698,
            onDutyTechCount30d: 6.8,
            groupbuyOrderShare30d: 0.31,
            groupbuyCohortCustomerCount: 17,
            groupbuy7dRevisitCustomerCount: 6,
            groupbuy7dRevisitRate: 6 / 17,
            groupbuy7dCardOpenedCustomerCount: 3,
            groupbuy7dCardOpenedRate: 3 / 17,
            groupbuy7dStoredValueConvertedCustomerCount: 3,
            groupbuy7dStoredValueConversionRate: 3 / 17,
            groupbuy30dMemberPayConvertedCustomerCount: 5,
            groupbuy30dMemberPayConversionRate: 5 / 17,
            groupbuyFirstOrderCustomerCount: 10,
            groupbuyFirstOrderHighValueMemberCustomerCount: 2,
            groupbuyFirstOrderHighValueMemberRate: 0.2,
            effectiveMembers: 88,
            sleepingMembers: 11,
            sleepingMemberRate: 11 / 88,
            newMembers30d: 22,
            activeTechCount30d: 5.9,
            currentStoredBalance: 2600,
            storedBalanceLifeMonths: 3.4,
            renewalPressureIndex30d: 1.07,
            memberRepurchaseBaseCustomerCount7d: 14,
            memberRepurchaseReturnedCustomerCount7d: 6,
            memberRepurchaseRate7d: 6 / 14,
          },
        ],
        "1004:2026-02-28:2026-02-28": [
          {
            orgId: "1004",
            windowEndBizDate: "2026-02-28",
            storeName: "锦苑店",
            revenue30d: 8400,
            orderCount30d: 96,
            customerCount30d: 96,
            totalClocks30d: 116,
            clockEffect30d: 72.41,
            averageTicket30d: 87.5,
            pointClockRate30d: 0.38,
            addClockRate30d: 0.22,
            rechargeCash30d: 1650,
            storedConsumeAmount30d: 2450,
            storedConsumeRate30d: 1.4848,
            onDutyTechCount30d: 6.4,
            groupbuyOrderShare30d: 0.39,
            groupbuyCohortCustomerCount: 15,
            groupbuy7dRevisitCustomerCount: 5,
            groupbuy7dRevisitRate: 5 / 15,
            groupbuy7dCardOpenedCustomerCount: 2,
            groupbuy7dCardOpenedRate: 2 / 15,
            groupbuy7dStoredValueConvertedCustomerCount: 2,
            groupbuy7dStoredValueConversionRate: 2 / 15,
            groupbuy30dMemberPayConvertedCustomerCount: 4,
            groupbuy30dMemberPayConversionRate: 4 / 15,
            groupbuyFirstOrderCustomerCount: 10,
            groupbuyFirstOrderHighValueMemberCustomerCount: 1,
            groupbuyFirstOrderHighValueMemberRate: 0.1,
            effectiveMembers: 74,
            sleepingMembers: 15,
            sleepingMemberRate: 15 / 74,
            newMembers30d: 18,
            activeTechCount30d: 5.6,
            currentStoredBalance: 1800,
            storedBalanceLifeMonths: 2.2,
            renewalPressureIndex30d: 1.48,
            memberRepurchaseBaseCustomerCount7d: 8,
            memberRepurchaseReturnedCustomerCount7d: 3,
            memberRepurchaseRate7d: 0.375,
          },
        ],
        "1005:2026-02-28:2026-02-28": [
          {
            orgId: "1005",
            windowEndBizDate: "2026-02-28",
            storeName: "迎宾店",
            revenue30d: 10800,
            orderCount30d: 108,
            customerCount30d: 108,
            totalClocks30d: 136,
            clockEffect30d: 79.41,
            averageTicket30d: 100,
            pointClockRate30d: 0.46,
            addClockRate30d: 0.31,
            rechargeCash30d: 3150,
            storedConsumeAmount30d: 2920,
            storedConsumeRate30d: 0.927,
            onDutyTechCount30d: 8.1,
            groupbuyOrderShare30d: 0.29,
            groupbuyCohortCustomerCount: 22,
            groupbuy7dRevisitCustomerCount: 10,
            groupbuy7dRevisitRate: 10 / 22,
            groupbuy7dCardOpenedCustomerCount: 5,
            groupbuy7dCardOpenedRate: 5 / 22,
            groupbuy7dStoredValueConvertedCustomerCount: 5,
            groupbuy7dStoredValueConversionRate: 5 / 22,
            groupbuy30dMemberPayConvertedCustomerCount: 8,
            groupbuy30dMemberPayConversionRate: 8 / 22,
            groupbuyFirstOrderCustomerCount: 10,
            groupbuyFirstOrderHighValueMemberCustomerCount: 4,
            groupbuyFirstOrderHighValueMemberRate: 0.4,
            effectiveMembers: 100,
            sleepingMembers: 9,
            sleepingMemberRate: 9 / 100,
            newMembers30d: 30,
            activeTechCount30d: 6.9,
            currentStoredBalance: 7800,
            storedBalanceLifeMonths: 8,
            renewalPressureIndex30d: 0.93,
            memberRepurchaseBaseCustomerCount7d: 17,
            memberRepurchaseReturnedCustomerCount7d: 10,
            memberRepurchaseRate7d: 10 / 17,
          },
        ],
      },
    });

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config: buildConfig(),
      binding: HQ_BINDING,
      text: "最近30天五个店整体怎么样，哪家最危险，下周总部先抓什么",
      now: new Date("2026-03-31T10:00:00+08:00"),
    });

    expect(result.text).toContain("近30天 总部经营全景");
    expect(result.text).toContain("当前储值余额合计 19500.00 元");
    expect(result.text).toContain("最短储值寿命 锦苑店 1.4 个月");
    expect(result.text).toContain("最高续费压力 锦苑店 1.80");
    expect(result.text).toContain("老会员复购最弱门店：锦苑店 25.0%（2/8）");
    expect(result.text).toContain("最危险门店");
    expect(result.text).toContain("锦苑店，风险分");
  });

  it("prefers stable 7-day review rows for HQ fleet revenue, stored-consume quality, and labor efficiency", async () => {
    const currentDates = [
      "2026-03-24",
      "2026-03-25",
      "2026-03-26",
      "2026-03-27",
      "2026-03-28",
      "2026-03-29",
      "2026-03-30",
    ];
    const previousDates = [
      "2026-03-17",
      "2026-03-18",
      "2026-03-19",
      "2026-03-20",
      "2026-03-21",
      "2026-03-22",
      "2026-03-23",
    ];
    const stores = [
      { orgId: "1001", storeName: "义乌店" },
      { orgId: "1002", storeName: "园中园店" },
      { orgId: "1003", storeName: "华美店" },
      { orgId: "1004", storeName: "锦苑店" },
      { orgId: "1005", storeName: "迎宾店" },
    ] as const;
    const reports: Record<string, DailyStoreReport> = {};
    for (const store of stores) {
      for (const bizDate of [...currentDates, ...previousDates]) {
        reports[`${store.orgId}:${bizDate}`] = buildReport({
          orgId: store.orgId,
          storeName: store.storeName,
          bizDate,
          metrics: {
            serviceRevenue: 100,
            serviceOrderCount: 1,
            totalClockCount: 2,
            averageTicket: 100,
            clockEffect: 50,
            activeTechCount: 1,
            onDutyTechCount: 1,
            newMembers: 1,
            rechargeCash: 10,
            storedConsumeAmount: 5,
            storedConsumeRate: 0.5,
            groupbuy7dRevisitRate: 0.4,
            groupbuy7dStoredValueConversionRate: 0.2,
            addClockRate: 0.3,
            sleepingMemberRate: 0.1,
          },
        });
      }
    }

    const runtime = buildRuntime({
      reports,
      storeReviewRows: {
        "1001:2026-03-30:2026-03-30": [
          {
            orgId: "1001",
            windowEndBizDate: "2026-03-30",
            storeName: "义乌店",
            revenue7d: 8500,
            orderCount7d: 42,
            customerCount7d: 42,
            totalClocks7d: 70,
            clockEffect7d: 121.43,
            averageTicket7d: 202.38,
            pointClockRate7d: 0.41,
            addClockRate7d: 0.23,
            groupbuyOrderShare7d: 0.38,
            groupbuyCohortCustomerCount: 18,
            groupbuy7dRevisitCustomerCount: 8,
            groupbuy7dRevisitRate: 8 / 18,
            groupbuy7dCardOpenedCustomerCount: 3,
            groupbuy7dCardOpenedRate: 3 / 18,
            groupbuy7dStoredValueConvertedCustomerCount: 4,
            groupbuy7dStoredValueConversionRate: 4 / 18,
            groupbuy30dMemberPayConvertedCustomerCount: 7,
            groupbuy30dMemberPayConversionRate: 7 / 18,
            groupbuyFirstOrderCustomerCount: 10,
            groupbuyFirstOrderHighValueMemberCustomerCount: 2,
            groupbuyFirstOrderHighValueMemberRate: 0.2,
            effectiveMembers: 60,
            sleepingMembers: 8,
            sleepingMemberRate: 8 / 60,
            newMembers7d: 12,
            activeTechCount7d: 5.8,
            rechargeCash7d: 3000,
            storedConsumeAmount7d: 2400,
            storedConsumeRate7d: 0.8,
            onDutyTechCount7d: 6.2,
            currentStoredBalance: 9800,
            storedBalanceLifeMonths: 4.2,
            renewalPressureIndex30d: 0.9,
            memberRepurchaseBaseCustomerCount7d: 20,
            memberRepurchaseReturnedCustomerCount7d: 11,
            memberRepurchaseRate7d: 0.55,
          },
        ],
        "1001:2026-03-23:2026-03-23": [
          {
            orgId: "1001",
            windowEndBizDate: "2026-03-23",
            storeName: "义乌店",
            revenue7d: 8000,
            orderCount7d: 40,
            customerCount7d: 40,
            totalClocks7d: 68,
            clockEffect7d: 117.65,
            averageTicket7d: 200,
            pointClockRate7d: 0.4,
            addClockRate7d: 0.22,
            groupbuyOrderShare7d: 0.37,
            groupbuyCohortCustomerCount: 18,
            groupbuy7dRevisitCustomerCount: 8,
            groupbuy7dRevisitRate: 8 / 18,
            groupbuy7dCardOpenedCustomerCount: 3,
            groupbuy7dCardOpenedRate: 3 / 18,
            groupbuy7dStoredValueConvertedCustomerCount: 4,
            groupbuy7dStoredValueConversionRate: 4 / 18,
            groupbuy30dMemberPayConvertedCustomerCount: 6,
            groupbuy30dMemberPayConversionRate: 6 / 18,
            groupbuyFirstOrderCustomerCount: 10,
            groupbuyFirstOrderHighValueMemberCustomerCount: 2,
            groupbuyFirstOrderHighValueMemberRate: 0.2,
            effectiveMembers: 58,
            sleepingMembers: 8,
            sleepingMemberRate: 8 / 58,
            newMembers7d: 10,
            activeTechCount7d: 5.6,
            rechargeCash7d: 2800,
            storedConsumeAmount7d: 2100,
            storedConsumeRate7d: 0.75,
            onDutyTechCount7d: 6,
          },
        ],
        "1002:2026-03-30:2026-03-30": [
          {
            orgId: "1002",
            windowEndBizDate: "2026-03-30",
            storeName: "园中园店",
            revenue7d: 7000,
            orderCount7d: 32,
            customerCount7d: 32,
            totalClocks7d: 56,
            clockEffect7d: 125,
            averageTicket7d: 218.75,
            pointClockRate7d: 0.46,
            addClockRate7d: 0.34,
            groupbuyOrderShare7d: 0.34,
            groupbuyCohortCustomerCount: 16,
            groupbuy7dRevisitCustomerCount: 8,
            groupbuy7dRevisitRate: 0.5,
            groupbuy7dCardOpenedCustomerCount: 4,
            groupbuy7dCardOpenedRate: 0.25,
            groupbuy7dStoredValueConvertedCustomerCount: 4,
            groupbuy7dStoredValueConversionRate: 0.25,
            groupbuy30dMemberPayConvertedCustomerCount: 7,
            groupbuy30dMemberPayConversionRate: 0.4375,
            groupbuyFirstOrderCustomerCount: 8,
            groupbuyFirstOrderHighValueMemberCustomerCount: 2,
            groupbuyFirstOrderHighValueMemberRate: 0.25,
            effectiveMembers: 48,
            sleepingMembers: 5,
            sleepingMemberRate: 5 / 48,
            newMembers7d: 10,
            activeTechCount7d: 4.6,
            rechargeCash7d: 2500,
            storedConsumeAmount7d: 2000,
            storedConsumeRate7d: 0.8,
            onDutyTechCount7d: 4,
            currentStoredBalance: 8600,
            storedBalanceLifeMonths: 5.1,
            renewalPressureIndex30d: 0.8,
            memberRepurchaseBaseCustomerCount7d: 18,
            memberRepurchaseReturnedCustomerCount7d: 9,
            memberRepurchaseRate7d: 0.5,
          },
        ],
        "1002:2026-03-23:2026-03-23": [
          {
            orgId: "1002",
            windowEndBizDate: "2026-03-23",
            storeName: "园中园店",
            revenue7d: 6000,
            orderCount7d: 30,
            customerCount7d: 30,
            totalClocks7d: 52,
            clockEffect7d: 115.38,
            averageTicket7d: 200,
            pointClockRate7d: 0.43,
            addClockRate7d: 0.31,
            groupbuyOrderShare7d: 0.32,
            groupbuyCohortCustomerCount: 16,
            groupbuy7dRevisitCustomerCount: 7,
            groupbuy7dRevisitRate: 0.4375,
            groupbuy7dCardOpenedCustomerCount: 3,
            groupbuy7dCardOpenedRate: 0.1875,
            groupbuy7dStoredValueConvertedCustomerCount: 3,
            groupbuy7dStoredValueConversionRate: 0.1875,
            groupbuy30dMemberPayConvertedCustomerCount: 6,
            groupbuy30dMemberPayConversionRate: 0.375,
            groupbuyFirstOrderCustomerCount: 8,
            groupbuyFirstOrderHighValueMemberCustomerCount: 1,
            groupbuyFirstOrderHighValueMemberRate: 0.125,
            effectiveMembers: 46,
            sleepingMembers: 6,
            sleepingMemberRate: 6 / 46,
            newMembers7d: 8,
            activeTechCount7d: 4.4,
            rechargeCash7d: 2200,
            storedConsumeAmount7d: 1650,
            storedConsumeRate7d: 0.75,
            onDutyTechCount7d: 4,
          },
        ],
        "1003:2026-03-30:2026-03-30": [
          {
            orgId: "1003",
            windowEndBizDate: "2026-03-30",
            storeName: "华美店",
            revenue7d: 6200,
            orderCount7d: 29,
            customerCount7d: 29,
            totalClocks7d: 50,
            clockEffect7d: 124,
            averageTicket7d: 213.79,
            pointClockRate7d: 0.44,
            addClockRate7d: 0.3,
            groupbuyOrderShare7d: 0.3,
            groupbuyCohortCustomerCount: 14,
            groupbuy7dRevisitCustomerCount: 6,
            groupbuy7dRevisitRate: 6 / 14,
            groupbuy7dCardOpenedCustomerCount: 3,
            groupbuy7dCardOpenedRate: 3 / 14,
            groupbuy7dStoredValueConvertedCustomerCount: 3,
            groupbuy7dStoredValueConversionRate: 3 / 14,
            groupbuy30dMemberPayConvertedCustomerCount: 5,
            groupbuy30dMemberPayConversionRate: 5 / 14,
            groupbuyFirstOrderCustomerCount: 7,
            groupbuyFirstOrderHighValueMemberCustomerCount: 1,
            groupbuyFirstOrderHighValueMemberRate: 1 / 7,
            effectiveMembers: 42,
            sleepingMembers: 4,
            sleepingMemberRate: 4 / 42,
            newMembers7d: 9,
            activeTechCount7d: 4.2,
            rechargeCash7d: 2000,
            storedConsumeAmount7d: 1600,
            storedConsumeRate7d: 0.8,
            onDutyTechCount7d: 4.2,
            currentStoredBalance: 7200,
            storedBalanceLifeMonths: 3.8,
            renewalPressureIndex30d: 1.1,
            memberRepurchaseBaseCustomerCount7d: 16,
            memberRepurchaseReturnedCustomerCount7d: 8,
            memberRepurchaseRate7d: 0.5,
          },
        ],
        "1003:2026-03-23:2026-03-23": [
          {
            orgId: "1003",
            windowEndBizDate: "2026-03-23",
            storeName: "华美店",
            revenue7d: 6200,
            orderCount7d: 29,
            customerCount7d: 29,
            totalClocks7d: 50,
            clockEffect7d: 124,
            averageTicket7d: 213.79,
            pointClockRate7d: 0.44,
            addClockRate7d: 0.3,
            groupbuyOrderShare7d: 0.3,
            groupbuyCohortCustomerCount: 14,
            groupbuy7dRevisitCustomerCount: 6,
            groupbuy7dRevisitRate: 6 / 14,
            groupbuy7dCardOpenedCustomerCount: 3,
            groupbuy7dCardOpenedRate: 3 / 14,
            groupbuy7dStoredValueConvertedCustomerCount: 3,
            groupbuy7dStoredValueConversionRate: 3 / 14,
            groupbuy30dMemberPayConvertedCustomerCount: 5,
            groupbuy30dMemberPayConversionRate: 5 / 14,
            groupbuyFirstOrderCustomerCount: 7,
            groupbuyFirstOrderHighValueMemberCustomerCount: 1,
            groupbuyFirstOrderHighValueMemberRate: 1 / 7,
            effectiveMembers: 42,
            sleepingMembers: 4,
            sleepingMemberRate: 4 / 42,
            newMembers7d: 9,
            activeTechCount7d: 4.2,
            rechargeCash7d: 2000,
            storedConsumeAmount7d: 1600,
            storedConsumeRate7d: 0.8,
            onDutyTechCount7d: 4.2,
          },
        ],
        "1004:2026-03-30:2026-03-30": [
          {
            orgId: "1004",
            windowEndBizDate: "2026-03-30",
            storeName: "锦苑店",
            revenue7d: 3000,
            orderCount7d: 18,
            customerCount7d: 18,
            totalClocks7d: 34,
            clockEffect7d: 88.24,
            averageTicket7d: 166.67,
            pointClockRate7d: 0.21,
            addClockRate7d: 0.15,
            groupbuyOrderShare7d: 0.5,
            groupbuyCohortCustomerCount: 12,
            groupbuy7dRevisitCustomerCount: 3,
            groupbuy7dRevisitRate: 0.25,
            groupbuy7dCardOpenedCustomerCount: 1,
            groupbuy7dCardOpenedRate: 1 / 12,
            groupbuy7dStoredValueConvertedCustomerCount: 1,
            groupbuy7dStoredValueConversionRate: 1 / 12,
            groupbuy30dMemberPayConvertedCustomerCount: 2,
            groupbuy30dMemberPayConversionRate: 2 / 12,
            groupbuyFirstOrderCustomerCount: 8,
            groupbuyFirstOrderHighValueMemberCustomerCount: 0,
            groupbuyFirstOrderHighValueMemberRate: 0,
            effectiveMembers: 30,
            sleepingMembers: 6,
            sleepingMemberRate: 0.2,
            newMembers7d: 4,
            activeTechCount7d: 3.2,
            rechargeCash7d: 1000,
            storedConsumeAmount7d: 300,
            storedConsumeRate7d: 0.3,
            onDutyTechCount7d: 3.6,
            currentStoredBalance: 2400,
            storedBalanceLifeMonths: 1.7,
            renewalPressureIndex30d: 1.8,
            memberRepurchaseBaseCustomerCount7d: 9,
            memberRepurchaseReturnedCustomerCount7d: 3,
            memberRepurchaseRate7d: 1 / 3,
          },
        ],
        "1004:2026-03-23:2026-03-23": [
          {
            orgId: "1004",
            windowEndBizDate: "2026-03-23",
            storeName: "锦苑店",
            revenue7d: 5000,
            orderCount7d: 24,
            customerCount7d: 24,
            totalClocks7d: 40,
            clockEffect7d: 125,
            averageTicket7d: 208.33,
            pointClockRate7d: 0.3,
            addClockRate7d: 0.22,
            groupbuyOrderShare7d: 0.42,
            groupbuyCohortCustomerCount: 12,
            groupbuy7dRevisitCustomerCount: 4,
            groupbuy7dRevisitRate: 1 / 3,
            groupbuy7dCardOpenedCustomerCount: 1,
            groupbuy7dCardOpenedRate: 1 / 12,
            groupbuy7dStoredValueConvertedCustomerCount: 1,
            groupbuy7dStoredValueConversionRate: 1 / 12,
            groupbuy30dMemberPayConvertedCustomerCount: 2,
            groupbuy30dMemberPayConversionRate: 2 / 12,
            groupbuyFirstOrderCustomerCount: 8,
            groupbuyFirstOrderHighValueMemberCustomerCount: 0,
            groupbuyFirstOrderHighValueMemberRate: 0,
            effectiveMembers: 32,
            sleepingMembers: 5,
            sleepingMemberRate: 5 / 32,
            newMembers7d: 5,
            activeTechCount7d: 3.5,
            rechargeCash7d: 1200,
            storedConsumeAmount7d: 480,
            storedConsumeRate7d: 0.4,
            onDutyTechCount7d: 3.8,
          },
        ],
        "1005:2026-03-30:2026-03-30": [
          {
            orgId: "1005",
            windowEndBizDate: "2026-03-30",
            storeName: "迎宾店",
            revenue7d: 3500,
            orderCount7d: 20,
            customerCount7d: 20,
            totalClocks7d: 36,
            clockEffect7d: 97.22,
            averageTicket7d: 175,
            pointClockRate7d: 0.32,
            addClockRate7d: 0.24,
            groupbuyOrderShare7d: 0.36,
            groupbuyCohortCustomerCount: 10,
            groupbuy7dRevisitCustomerCount: 4,
            groupbuy7dRevisitRate: 0.4,
            groupbuy7dCardOpenedCustomerCount: 2,
            groupbuy7dCardOpenedRate: 0.2,
            groupbuy7dStoredValueConvertedCustomerCount: 2,
            groupbuy7dStoredValueConversionRate: 0.2,
            groupbuy30dMemberPayConvertedCustomerCount: 3,
            groupbuy30dMemberPayConversionRate: 0.3,
            groupbuyFirstOrderCustomerCount: 7,
            groupbuyFirstOrderHighValueMemberCustomerCount: 1,
            groupbuyFirstOrderHighValueMemberRate: 1 / 7,
            effectiveMembers: 36,
            sleepingMembers: 4,
            sleepingMemberRate: 4 / 36,
            newMembers7d: 6,
            activeTechCount7d: 3.8,
            rechargeCash7d: 1500,
            storedConsumeAmount7d: 1050,
            storedConsumeRate7d: 0.7,
            onDutyTechCount7d: 4,
            currentStoredBalance: 3000,
            storedBalanceLifeMonths: 2.4,
            renewalPressureIndex30d: 1.5,
            memberRepurchaseBaseCustomerCount7d: 10,
            memberRepurchaseReturnedCustomerCount7d: 4,
            memberRepurchaseRate7d: 0.4,
          },
        ],
        "1005:2026-03-23:2026-03-23": [
          {
            orgId: "1005",
            windowEndBizDate: "2026-03-23",
            storeName: "迎宾店",
            revenue7d: 3600,
            orderCount7d: 20,
            customerCount7d: 20,
            totalClocks7d: 36,
            clockEffect7d: 100,
            averageTicket7d: 180,
            pointClockRate7d: 0.33,
            addClockRate7d: 0.25,
            groupbuyOrderShare7d: 0.36,
            groupbuyCohortCustomerCount: 10,
            groupbuy7dRevisitCustomerCount: 4,
            groupbuy7dRevisitRate: 0.4,
            groupbuy7dCardOpenedCustomerCount: 2,
            groupbuy7dCardOpenedRate: 0.2,
            groupbuy7dStoredValueConvertedCustomerCount: 2,
            groupbuy7dStoredValueConversionRate: 0.2,
            groupbuy30dMemberPayConvertedCustomerCount: 3,
            groupbuy30dMemberPayConversionRate: 0.3,
            groupbuyFirstOrderCustomerCount: 7,
            groupbuyFirstOrderHighValueMemberCustomerCount: 1,
            groupbuyFirstOrderHighValueMemberRate: 1 / 7,
            effectiveMembers: 36,
            sleepingMembers: 4,
            sleepingMemberRate: 4 / 36,
            newMembers7d: 6,
            activeTechCount7d: 3.8,
            rechargeCash7d: 1500,
            storedConsumeAmount7d: 1050,
            storedConsumeRate7d: 0.7,
            onDutyTechCount7d: 4,
          },
        ],
      },
    });

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "近7天五个店整体怎么样，哪家在拉升，哪家最危险，下周总部先抓什么",
      now,
    });

    expect(result.text).toContain("5店合计服务营收 28200.00 元");
    expect(result.text).toContain("储值耗卡比 73.5%");
    expect(result.text).toContain("当前储值余额合计 31000.00 元");
    expect(result.text).toContain("最短储值寿命 锦苑店 1.7 个月");
    expect(result.text).toContain("最高续费压力 锦苑店 1.80");
    expect(result.text).toContain(
      "园中园店 7000.00 元（环比 +16.7%）客单价 219 元，人效 1750 元/人",
    );
    expect(result.text).toContain("储值耗卡比最弱门店：锦苑店 30.0%");
    expect(result.text).toContain("老会员复购最弱门店：锦苑店 33.3%（3/9）");
    expect(result.text).toContain(
      "资金与留存：储值寿命 1.7 个月，续费压力 1.80，会员7日复购率 33.3%（3/9）",
    );
    expect(result.text).toContain("储值寿命偏短或续费压力偏高");
    expect(result.text).toContain("老会员7日复购率偏低");
    expect(result.text).toContain("锦苑店");
  });

  it("answers customer-segment and customer-tech relationship questions from marts", async () => {
    const runtime = buildRuntime({
      reports: {
        "1001:2026-03-30": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-30",
        }),
      },
      customerSegments: {
        "1001:2026-03-30": [
          buildCustomerSegment({
            customerIdentityKey: "member:wang",
            customerDisplayName: "王先生",
            memberId: "member-wang",
            memberCardNo: "yw001",
            referenceCode: "yw001",
            primarySegment: "important-value-member",
            tagKeys: ["important-value-member", "single-tech-loyal"],
            topTechCode: "T001",
            topTechName: "杜莎",
            topTechVisitCount90d: 5,
            topTechVisitShare90d: 5 / 6,
            payAmount90d: 1680,
            payAmount30d: 780,
            visitCount90d: 6,
            visitCount30d: 3,
          }),
          buildCustomerSegment({
            customerIdentityKey: "member:li",
            customerDisplayName: "李女士",
            memberId: "member-li",
            memberCardNo: "yw002",
            referenceCode: "yw002",
            primarySegment: "important-value-member",
            topTechCode: "T001",
            topTechName: "杜莎",
            topTechVisitCount90d: 4,
            topTechVisitShare90d: 0.8,
            payAmount90d: 1320,
            payAmount30d: 620,
            visitCount90d: 5,
            visitCount30d: 2,
          }),
          buildCustomerSegment({
            customerIdentityKey: "member:zhou",
            customerDisplayName: "周先生",
            memberId: "member-zhou",
            memberCardNo: "yw003",
            referenceCode: "yw003",
            primarySegment: "sleeping-customer",
            recencySegment: "sleeping-91-180d",
            daysSinceLastVisit: 128,
            payAmount90d: 420,
            payAmount30d: 0,
            visitCount90d: 2,
            visitCount30d: 0,
            topTechCode: "T002",
            topTechName: "阿明",
            topTechVisitCount90d: 2,
            topTechVisitShare90d: 1,
            tagKeys: ["sleeping-customer", "single-tech-loyal"],
          }),
        ],
      },
      customerTechLinks: {
        "1001:2026-03-29": [
          buildCustomerTechLink({
            bizDate: "2026-03-29",
            settleId: "S-101",
            settleNo: "NO-101",
            customerIdentityKey: "member:wang",
            customerDisplayName: "王先生",
            memberId: "member-wang",
            memberCardNo: "yw001",
            referenceCode: "yw001",
            techCode: "T001",
            techName: "杜莎",
            itemNames: ["荷悦SPA"],
          }),
          buildCustomerTechLink({
            bizDate: "2026-03-29",
            settleId: "S-102",
            settleNo: "NO-102",
            customerIdentityKey: "member:li",
            customerDisplayName: "李女士",
            memberId: "member-li",
            memberCardNo: "yw002",
            referenceCode: "yw002",
            techCode: "T001",
            techName: "杜莎",
            itemNames: ["精致足道"],
          }),
        ],
        "1001:2026-03-25": [
          buildCustomerTechLink({
            bizDate: "2026-03-25",
            settleId: "S-103",
            settleNo: "NO-103",
            customerIdentityKey: "member:wang",
            customerDisplayName: "王先生",
            memberId: "member-wang",
            memberCardNo: "yw001",
            referenceCode: "yw001",
            techCode: "T002",
            techName: "阿明",
            itemNames: ["古法足疗"],
          }),
        ],
      },
    });
    const storeManager: HetangEmployeeBinding = {
      channel: "wecom",
      senderId: "manager-yiwu",
      employeeName: "义乌店长",
      role: "manager",
      isActive: true,
      scopeOrgIds: ["1001"],
    };

    const importantCount = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: storeManager,
      text: "重要价值会员有多少",
      now,
    });
    const sleepingList = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: storeManager,
      text: "沉睡会员名单",
      now,
    });
    const sleepingDefaultList = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: storeManager,
      text: "查一下沉睡会员",
      now,
    });
    const customerTechs = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: storeManager,
      text: "王先生最近30天被哪些技师服务过",
      now,
    });
    const techCustomers = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: storeManager,
      text: "杜莎最近30天服务了哪些高价值会员",
      now,
    });
    const boundRanking = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: storeManager,
      text: "义乌店哪个技师绑定的高价值会员最多",
      now,
    });
    const customerProfile = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: storeManager,
      text: "王先生现在是什么标签",
      now,
    });

    expect(importantCount.text).toContain("重要价值会员 2 人");
    expect(sleepingList.text).toContain("周先生");
    expect(sleepingDefaultList.text).toContain("沉睡会员名单");
    expect(sleepingDefaultList.text).toContain("周先生");
    expect(sleepingList.text).toContain("近 90 天支付 420.00 元");
    expect(customerTechs.text).toContain("杜莎");
    expect(customerTechs.text).toContain("阿明");
    expect(customerTechs.text).toContain("共服务 2 次");
    expect(techCustomers.text).toContain("杜莎");
    expect(techCustomers.text).toContain("王先生");
    expect(techCustomers.text).toContain("李女士");
    expect(boundRanking.text).toContain("杜莎 2 位");
    expect(customerProfile.text).toContain("重要价值会员");
    expect(customerProfile.text).toContain("主服务技师: 杜莎");
  });

  it("returns grouped follow-up customer buckets for monthly boss-style asks", async () => {
    const runtime = buildRuntime({
      customerSegments: {
        "1003:2026-03-31": [
          buildCustomerSegment({
            orgId: "1003",
            bizDate: "2026-03-31",
            customerIdentityKey: "member:huimei-zhou",
            customerDisplayName: "周先生",
            memberId: "member-huimei-zhou",
            memberCardNo: "hm001",
            referenceCode: "hm001",
            primarySegment: "important-reactivation-member",
            recencySegment: "silent-31-90d",
            daysSinceLastVisit: 46,
            payAmount90d: 1860,
            payAmount30d: 0,
            visitCount90d: 6,
            visitCount30d: 0,
            topTechName: "安妮",
            topTechVisitCount90d: 5,
            topTechVisitShare90d: 5 / 6,
            tagKeys: ["important-reactivation-member", "single-tech-loyal"],
          }),
          buildCustomerSegment({
            orgId: "1003",
            bizDate: "2026-03-31",
            customerIdentityKey: "member:huimei-li",
            customerDisplayName: "李女士",
            memberId: "member-huimei-li",
            memberCardNo: "hm002",
            referenceCode: "hm002",
            primarySegment: "potential-growth-customer",
            recencySegment: "active-30d",
            daysSinceLastVisit: 18,
            payAmount90d: 980,
            payAmount30d: 420,
            visitCount90d: 4,
            visitCount30d: 2,
            topTechName: "可可",
            topTechVisitCount90d: 3,
            topTechVisitShare90d: 0.75,
            tagKeys: ["potential-growth-customer"],
          }),
          buildCustomerSegment({
            orgId: "1003",
            bizDate: "2026-03-31",
            customerIdentityKey: "member:huimei-wang",
            customerDisplayName: "王小姐",
            memberId: "member-huimei-wang",
            memberCardNo: "hm003",
            referenceCode: "hm003",
            primarySegment: "groupbuy-retain-candidate",
            recencySegment: "active-30d",
            daysSinceLastVisit: 9,
            payAmount90d: 620,
            payAmount30d: 260,
            visitCount90d: 3,
            visitCount30d: 2,
            groupbuyAmount90d: 620,
            memberPayAmount90d: 0,
            directPayAmount90d: 0,
            topTechName: "小雅",
            topTechVisitCount90d: 2,
            topTechVisitShare90d: 2 / 3,
            tagKeys: ["groupbuy-retain-candidate"],
          }),
          buildCustomerSegment({
            orgId: "1003",
            bizDate: "2026-03-31",
            customerIdentityKey: "member:huimei-chen",
            customerDisplayName: "陈女士",
            memberId: "member-huimei-chen",
            memberCardNo: "hm004",
            referenceCode: "hm004",
            primarySegment: "important-value-member",
            recencySegment: "active-30d",
            daysSinceLastVisit: 23,
            payAmount90d: 1580,
            payAmount30d: 320,
            visitCount90d: 5,
            visitCount30d: 1,
            topTechName: "可可",
            topTechVisitCount90d: 4,
            topTechVisitShare90d: 0.8,
            tagKeys: ["important-value-member"],
          }),
        ],
      },
    });

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "华美店3月份最值得跟进的顾客有哪些",
      now: new Date("2026-04-04T09:00:00+08:00"),
    });

    expect(result.text).toContain("华美店 3月份 跟进顾客分层名单");
    expect(result.text).toContain("高价值待唤回");
    expect(result.text).toContain("1. 周先生");
    expect(result.text).toContain("2. 陈女士");
    expect(result.text).toContain("潜力成长");
    expect(result.text).toContain("1. 李女士");
    expect(result.text).toContain("团购留存");
    expect(result.text).toContain("1. 王小姐");
  });

  it("returns grouped follow-up customer buckets for '哪10个顾客最需要跟进' phrasing", async () => {
    const runtime = buildRuntime({
      customerSegments: {
        "1005:2026-04-03": [
          buildCustomerSegment({
            orgId: "1005",
            bizDate: "2026-04-03",
            customerIdentityKey: "member:yingbin-zhou",
            customerDisplayName: "周先生",
            memberId: "member-yingbin-zhou",
            memberCardNo: "yb001",
            referenceCode: "yb001",
            primarySegment: "important-reactivation-member",
            recencySegment: "silent-31-90d",
            daysSinceLastVisit: 48,
            payAmount90d: 1980,
            payAmount30d: 0,
            visitCount90d: 6,
            visitCount30d: 0,
            topTechName: "可可",
            topTechVisitCount90d: 4,
            topTechVisitShare90d: 4 / 6,
            tagKeys: ["important-reactivation-member"],
          }),
          buildCustomerSegment({
            orgId: "1005",
            bizDate: "2026-04-03",
            customerIdentityKey: "member:yingbin-li",
            customerDisplayName: "李女士",
            memberId: "member-yingbin-li",
            memberCardNo: "yb002",
            referenceCode: "yb002",
            primarySegment: "potential-growth-customer",
            recencySegment: "active-30d",
            daysSinceLastVisit: 12,
            payAmount90d: 820,
            payAmount30d: 260,
            visitCount90d: 3,
            visitCount30d: 1,
            topTechName: "阿宁",
            topTechVisitCount90d: 2,
            topTechVisitShare90d: 2 / 3,
            tagKeys: ["potential-growth-customer"],
          }),
          buildCustomerSegment({
            orgId: "1005",
            bizDate: "2026-04-03",
            customerIdentityKey: "member:yingbin-wang",
            customerDisplayName: "王小姐",
            memberId: "member-yingbin-wang",
            memberCardNo: "yb003",
            referenceCode: "yb003",
            primarySegment: "groupbuy-retain-candidate",
            recencySegment: "active-7d",
            daysSinceLastVisit: 5,
            payAmount90d: 268,
            payAmount30d: 268,
            visitCount90d: 2,
            visitCount30d: 2,
            topTechName: "小雅",
            topTechVisitCount90d: 2,
            topTechVisitShare90d: 1,
            tagKeys: ["groupbuy-retain-candidate"],
          }),
        ],
      },
    });

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "迎宾店 过去30天 哪10个顾客 最需要跟进",
      now: new Date("2026-04-05T01:00:08+08:00"),
    });

    expect(result.text).toContain("迎宾店 过去30天 跟进顾客分层名单");
    expect(result.text).toContain("高价值待唤回");
    expect(result.text).toContain("周先生");
    expect(result.text).toContain("潜力成长");
    expect(result.text).toContain("李女士");
    expect(result.text).toContain("团购留存");
    expect(result.text).toContain("王小姐");
  });

  it("prefers the reactivation execution queue when runtime exposes it for follow-up asks", async () => {
    const runtime = buildRuntime({
      reports: {},
      customerSegments: {
        "1005:2026-04-03": [
          buildCustomerSegment({
            orgId: "1005",
            bizDate: "2026-04-03",
            customerIdentityKey: "member:yingbin-zhou",
            customerDisplayName: "周先生",
            memberId: "member-yingbin-zhou",
            memberCardNo: "yb001",
            referenceCode: "yb001",
            primarySegment: "important-reactivation-member",
            recencySegment: "silent-31-90d",
            daysSinceLastVisit: 48,
            payAmount90d: 1980,
            payAmount30d: 0,
            visitCount90d: 6,
            visitCount30d: 0,
            topTechName: "可可",
            topTechVisitCount90d: 4,
            topTechVisitShare90d: 4 / 6,
            tagKeys: ["important-reactivation-member"],
          }),
        ],
      },
      memberReactivationQueue: {
        "1005:2026-04-03": [
          {
            orgId: "1005",
            bizDate: "2026-04-03",
            memberId: "member-yingbin-zhou",
            customerIdentityKey: "member:yingbin-zhou",
            customerDisplayName: "周先生",
            memberCardNo: "yb001",
            referenceCode: "yb001",
            primarySegment: "important-reactivation-member",
            followupBucket: "high-value-reactivation",
            reactivationPriorityScore: 760,
            strategyPriorityScore: 980,
            executionPriorityScore: 980,
            priorityBand: "P0",
            priorityRank: 1,
            churnRiskLabel: "critical",
            churnRiskScore: 0.88,
            revisitWindowLabel: "due-now",
            recommendedActionLabel: "immediate-1to1",
            recommendedTouchWeekday: "thursday",
            recommendedTouchDaypart: "after-work",
            touchWindowLabel: "best-today",
            reasonSummary: "已沉默48天，近90天消费1980.00元，优先联系熟悉技师可可。",
            touchAdviceSummary: "建议周四 after-work 联系，今天就是最好窗口。",
            daysSinceLastVisit: 48,
            visitCount90d: 6,
            payAmount90d: 1980,
            currentStoredBalanceInferred: 520,
            projectedBalanceDaysLeft: 28,
            birthdayMonthDay: null,
            nextBirthdayBizDate: null,
            birthdayWindowDays: null,
            birthdayBoostScore: 0,
            topTechName: "可可",
            queueJson: "{}",
            updatedAt: "2026-04-03T10:00:00+08:00",
          },
        ],
      },
    });

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "迎宾店 过去30天 哪10个顾客 最需要跟进",
      now: new Date("2026-04-05T14:43:38+08:00"),
    });

    expect(result.text).toContain("迎宾店 过去30天 召回执行名单");
    expect(result.text).toContain("P0");
    expect(result.text).toContain("周先生");
    expect(result.text).toContain("建议周四 after-work 联系");
  });

  it("answers recall-style single-customer asks with the reactivation execution queue", async () => {
    const runtime = buildRuntime({
      reports: {},
      customerSegments: {
        "1001:2026-04-12": [
          buildCustomerSegment({
            orgId: "1001",
            bizDate: "2026-04-12",
            customerIdentityKey: "member:yiwu-zhou",
            customerDisplayName: "周先生",
            memberId: "member-yiwu-zhou",
            memberCardNo: "yw001",
            referenceCode: "yw001",
            primarySegment: "important-reactivation-member",
            recencySegment: "silent-31-90d",
            daysSinceLastVisit: 42,
            payAmount90d: 2860,
            payAmount30d: 0,
            visitCount90d: 7,
            visitCount30d: 0,
            topTechName: "可可",
            topTechVisitCount90d: 4,
            topTechVisitShare90d: 4 / 7,
            tagKeys: ["important-reactivation-member"],
          }),
        ],
      },
      memberReactivationQueue: {
        "1001:2026-04-12": [
          {
            orgId: "1001",
            bizDate: "2026-04-12",
            memberId: "member-yiwu-zhou",
            customerIdentityKey: "member:yiwu-zhou",
            customerDisplayName: "周先生",
            memberCardNo: "yw001",
            referenceCode: "yw001",
            primarySegment: "important-reactivation-member",
            followupBucket: "high-value-reactivation",
            reactivationPriorityScore: 782,
            strategyPriorityScore: 960,
            executionPriorityScore: 960,
            priorityBand: "P0",
            priorityRank: 1,
            churnRiskLabel: "critical",
            churnRiskScore: 0.91,
            revisitWindowLabel: "due-now",
            recommendedActionLabel: "immediate-1to1",
            recommendedTouchWeekday: "monday",
            recommendedTouchDaypart: "afternoon",
            touchWindowLabel: "best-today",
            reasonSummary: "已沉默42天，近90天消费2860.00元，优先联系熟悉技师可可。",
            touchAdviceSummary: "今天下午先电话触达，再锁下一次到店时段。",
            daysSinceLastVisit: 42,
            visitCount90d: 7,
            payAmount90d: 2860,
            currentStoredBalanceInferred: 680,
            projectedBalanceDaysLeft: 35,
            birthdayMonthDay: null,
            nextBirthdayBizDate: null,
            birthdayWindowDays: null,
            birthdayBoostScore: 0,
            topTechName: "可可",
            queueJson: "{}",
            updatedAt: "2026-04-12T10:00:00+08:00",
          },
        ],
      },
    });

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "义乌店最值得召回的顾客是哪个",
      now: new Date("2026-04-13T20:30:00+08:00"),
    });

    expect(result.text).toContain("义乌店");
    expect(result.text).toContain("召回执行名单");
    expect(result.text).toContain("周先生");
    expect(result.text).not.toContain("未识别为可执行的门店数据问题");
  });

  it("falls back to the latest available customer snapshot when the target day has not been generated yet", async () => {
    const runtime = buildRuntime({
      reports: {},
      customerSegments: {
        "1005:2026-04-03": [
          buildCustomerSegment({
            orgId: "1005",
            bizDate: "2026-04-03",
            customerIdentityKey: "member:yingbin-li",
            customerDisplayName: "李女士",
            memberId: "member-yingbin-li",
            memberCardNo: "yb002",
            referenceCode: "yb002",
            primarySegment: "potential-growth-customer",
            recencySegment: "active-30d",
            daysSinceLastVisit: 12,
            payAmount90d: 820,
            payAmount30d: 260,
            visitCount90d: 3,
            visitCount30d: 1,
            topTechName: "阿宁",
            topTechVisitCount90d: 2,
            topTechVisitShare90d: 2 / 3,
            tagKeys: ["potential-growth-customer"],
          }),
        ],
      },
    });

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "迎宾店 过去30天 哪10个顾客 最需要跟进",
      now: new Date("2026-04-05T14:43:38+08:00"),
    });

    expect(result.text).toContain("迎宾店 过去30天 跟进顾客分层名单（按 2026-04-03 客群快照）");
    expect(result.text).toContain("潜力成长");
    expect(result.text).toContain("李女士");
  });

  it("treats 高价值待唤回名单 as a follow-up bucket list instead of an empty strict segment", async () => {
    const runtime = buildRuntime({
      reports: {},
      customerSegments: {
        "1005:2026-04-03": [
          buildCustomerSegment({
            orgId: "1005",
            bizDate: "2026-04-03",
            customerIdentityKey: "member:yingbin-qiao",
            customerDisplayName: "乔先生",
            memberId: "member-yingbin-qiao",
            memberCardNo: "yb009",
            referenceCode: "yb009",
            primarySegment: "important-value-member",
            recencySegment: "active-30d",
            daysSinceLastVisit: 21,
            payAmount90d: 2811,
            payAmount30d: 0,
            visitCount90d: 4,
            visitCount30d: 0,
            topTechName: "李红儿",
            topTechVisitCount90d: 3,
            topTechVisitShare90d: 0.75,
            tagKeys: ["important-value-member"],
          }),
          buildCustomerSegment({
            orgId: "1005",
            bizDate: "2026-04-03",
            customerIdentityKey: "member:yingbin-li",
            customerDisplayName: "李女士",
            memberId: "member-yingbin-li",
            memberCardNo: "yb002",
            referenceCode: "yb002",
            primarySegment: "potential-growth-customer",
            recencySegment: "active-30d",
            daysSinceLastVisit: 12,
            payAmount90d: 820,
            payAmount30d: 260,
            visitCount90d: 3,
            visitCount30d: 1,
            topTechName: "阿宁",
            topTechVisitCount90d: 2,
            topTechVisitShare90d: 2 / 3,
            tagKeys: ["potential-growth-customer"],
          }),
        ],
      },
    });

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "迎宾店 高价值待唤回名单",
      now: new Date("2026-04-05T14:43:53+08:00"),
    });

    expect(result.text).toContain("迎宾店 2026-04-03 高价值待唤回名单");
    expect(result.text).toContain("乔先生");
    expect(result.text).not.toContain("共 0 人");
  });

  it("falls back to grouped follow-up buckets instead of a generic miss when store rows exist", async () => {
    const runtime = buildRuntime({
      customerSegments: {
        "1005:2026-04-03": [
          buildCustomerSegment({
            orgId: "1005",
            bizDate: "2026-04-03",
            customerIdentityKey: "member:yingbin-zhou",
            customerDisplayName: "周先生",
            memberId: "member-yingbin-zhou",
            memberCardNo: "yb001",
            referenceCode: "yb001",
            primarySegment: "important-reactivation-member",
            recencySegment: "silent-31-90d",
            daysSinceLastVisit: 48,
            payAmount90d: 1980,
            payAmount30d: 0,
            visitCount90d: 6,
            visitCount30d: 0,
            topTechName: "可可",
            topTechVisitCount90d: 4,
            topTechVisitShare90d: 4 / 6,
            segmentEligible: false,
            tagKeys: ["important-reactivation-member"],
          }),
          buildCustomerSegment({
            orgId: "1005",
            bizDate: "2026-04-03",
            customerIdentityKey: "member:yingbin-li",
            customerDisplayName: "李女士",
            memberId: "member-yingbin-li",
            memberCardNo: "yb002",
            referenceCode: "yb002",
            primarySegment: "potential-growth-customer",
            recencySegment: "active-30d",
            daysSinceLastVisit: 12,
            payAmount90d: 820,
            payAmount30d: 260,
            visitCount90d: 3,
            visitCount30d: 1,
            topTechName: "阿宁",
            topTechVisitCount90d: 2,
            topTechVisitShare90d: 2 / 3,
            segmentEligible: false,
            tagKeys: ["potential-growth-customer"],
          }),
          buildCustomerSegment({
            orgId: "1005",
            bizDate: "2026-04-03",
            customerIdentityKey: "member:yingbin-wang",
            customerDisplayName: "王小姐",
            memberId: "member-yingbin-wang",
            memberCardNo: "yb003",
            referenceCode: "yb003",
            primarySegment: "groupbuy-retain-candidate",
            recencySegment: "active-7d",
            daysSinceLastVisit: 5,
            payAmount90d: 268,
            payAmount30d: 268,
            visitCount90d: 2,
            visitCount30d: 2,
            topTechName: "小雅",
            topTechVisitCount90d: 2,
            topTechVisitShare90d: 1,
            identityStable: false,
            tagKeys: ["groupbuy-retain-candidate"],
          }),
        ],
      },
    });

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "迎宾店 过去30天 哪10个顾客 最需要跟进",
      now: new Date("2026-04-05T01:00:08+08:00"),
    });

    expect(result.text).toContain("迎宾店 过去30天 跟进顾客分层名单");
    expect(result.text).toContain("高价值待唤回");
    expect(result.text).toContain("周先生");
    expect(result.text).toContain("潜力成长");
    expect(result.text).toContain("李女士");
    expect(result.text).toContain("团购留存");
    expect(result.text).toContain("王小姐");
    expect(result.text).not.toContain("暂未筛出明确的重点跟进顾客");
  });

  it("tightens identity-unstable tech hints on runtime customer-segment fallbacks", async () => {
    const runtime = buildRuntime({
      customerSegments: {
        "1001:2026-03-30": [
          buildCustomerSegment({
            orgId: "1001",
            bizDate: "2026-03-30",
            customerIdentityKey: "member:stable-high-value",
            customerDisplayName: "周先生",
            memberId: "member-stable-high-value",
            memberCardNo: "yw100",
            referenceCode: "yw100",
            primarySegment: "important-value-member",
            payAmount90d: 1800,
            payAmount30d: 680,
            visitCount90d: 5,
            visitCount30d: 2,
            topTechName: "杜莎",
            topTechVisitCount90d: 3,
            topTechVisitShare90d: 0.6,
            identityStable: true,
            tagKeys: ["important-value-member"],
          }),
          buildCustomerSegment({
            orgId: "1001",
            bizDate: "2026-03-30",
            customerIdentityKey: "member:unstable-high-value",
            customerDisplayName: "王女士",
            memberId: "member-unstable-high-value",
            memberCardNo: "yw101",
            referenceCode: "yw101",
            primarySegment: "important-value-member",
            payAmount90d: 1600,
            payAmount30d: 520,
            visitCount90d: 4,
            visitCount30d: 2,
            topTechName: "错误技师",
            topTechVisitCount90d: 2,
            topTechVisitShare90d: 0.5,
            identityStable: false,
            tagKeys: ["important-value-member"],
          }),
        ],
      },
    });

    const rankingResult = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yiwu",
        employeeName: "义乌店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1001"],
      },
      text: "义乌店哪个技师绑定的高价值会员最多",
      now,
    });
    const listResult = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yiwu",
        employeeName: "义乌店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1001"],
      },
      text: "义乌店高价值会员名单",
      now,
    });
    const profileResult = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yiwu",
        employeeName: "义乌店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1001"],
      },
      text: "王女士现在是什么标签",
      now,
    });

    expect(rankingResult.text).toContain("杜莎 1 位");
    expect(rankingResult.text).not.toContain("错误技师");
    expect(listResult.text).toContain("王女士");
    expect(listResult.text).not.toContain("错误技师");
    expect(profileResult.text).toContain("身份未稳定");
    expect(profileResult.text).not.toContain("错误技师");
  });

  it("answers phone-suffix customer profile questions with masked preferences and ambiguity handling", async () => {
    const runtime = {
      ...buildRuntime({
        reports: {
          "1001:2026-03-30": buildReport({
            orgId: "1001",
            storeName: "义乌店",
            bizDate: "2026-03-30",
          }),
        },
        customerSegments: {
          "1001:2026-03-29": [
            buildCustomerSegment({
              bizDate: "2026-03-29",
              customerIdentityKey: "member:member-han",
              customerDisplayName: "韩先生",
              memberId: "member-han",
              memberCardNo: "yw7500",
              referenceCode: "yw7500",
              payAmount90d: 1680,
              payAmount30d: 780,
              visitCount90d: 6,
              visitCount30d: 3,
              topTechCode: "090",
              topTechName: "杜丽沙",
              topTechVisitCount90d: 4,
              topTechVisitShare90d: 4 / 6,
              primarySegment: "important-value-member",
            }),
          ],
        },
      }),
      findCurrentMembersByPhoneSuffix: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          memberId: "member-han",
          name: "韩先生",
          phone: "18503727500",
          storedAmount: 1280,
          consumeAmount: 4680,
          createdTime: "2026-01-01",
          lastConsumeTime: "2026-03-28",
          silentDays: 3,
          rawJson: "{}",
        },
      ]),
      listCurrentMemberCards: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          memberId: "member-han",
          cardId: "card-001",
          cardNo: "yw7500",
          rawJson: "{}",
        },
      ]),
      listConsumeBillsByDateRange: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          settleId: "S-201",
          settleNo: "XF2603280001",
          payAmount: 298,
          consumeAmount: 298,
          discountAmount: 0,
          antiFlag: false,
          optTime: "2026-03-28 20:15:00",
          bizDate: "2026-03-28",
          rawJson: JSON.stringify({
            SettleId: "S-201",
            SettleNo: "XF2603280001",
            Payments: [
              { Name: "会员", Amount: 238, PaymentType: 3 },
              { Name: "微信", Amount: 60, PaymentType: 4 },
            ],
            Infos: ["韩先生 (金悦卡) [yw7500],消费298.00元;"],
          }),
        },
        {
          orgId: "1001",
          settleId: "S-202",
          settleNo: "XF2603220000",
          payAmount: 229,
          consumeAmount: 229,
          discountAmount: 0,
          antiFlag: false,
          optTime: "2026-03-22 11:14:18",
          bizDate: "2026-03-22",
          rawJson: JSON.stringify({
            SettleId: "S-202",
            SettleNo: "XF2603220000",
            Payments: [{ Name: "会员", Amount: 229, PaymentType: 3 }],
            Infos: ["韩先生 (金悦卡) [yw7500],消费229.00元;"],
          }),
        },
      ]),
      listCustomerTechLinksByDateRange: vi.fn().mockResolvedValue([
        buildCustomerTechLink({
          bizDate: "2026-03-28",
          settleId: "S-201",
          settleNo: "XF2603280001",
          customerIdentityKey: "member:member-han",
          customerDisplayName: "韩先生",
          memberId: "member-han",
          memberCardNo: "yw7500",
          referenceCode: "yw7500",
          techCode: "090",
          techName: "杜丽沙",
          techTurnover: 298,
          itemNames: ["荷悦SPA"],
        }),
        buildCustomerTechLink({
          bizDate: "2026-03-22",
          settleId: "S-202",
          settleNo: "XF2603220000",
          customerIdentityKey: "member:member-han",
          customerDisplayName: "韩先生",
          memberId: "member-han",
          memberCardNo: "yw7500",
          referenceCode: "yw7500",
          techCode: "090",
          techName: "杜丽沙",
          techTurnover: 229,
          itemNames: ["荷悦SPA加钟"],
        }),
      ]),
      listCustomerTechLinks: vi.fn().mockResolvedValue([
        buildCustomerTechLink({
          bizDate: "2026-03-28",
          settleId: "S-201",
          settleNo: "XF2603280001",
          customerIdentityKey: "member:member-han",
          customerDisplayName: "韩先生",
          memberId: "member-han",
          memberCardNo: "yw7500",
          referenceCode: "yw7500",
          techCode: "090",
          techName: "杜丽沙",
          techTurnover: 298,
          itemNames: ["荷悦SPA"],
        }),
        buildCustomerTechLink({
          bizDate: "2026-03-22",
          settleId: "S-202",
          settleNo: "XF2603220000",
          customerIdentityKey: "member:member-han",
          customerDisplayName: "韩先生",
          memberId: "member-han",
          memberCardNo: "yw7500",
          referenceCode: "yw7500",
          techCode: "090",
          techName: "杜丽沙",
          techTurnover: 229,
          itemNames: ["荷悦SPA加钟"],
        }),
      ]),
      listTechMarketByDateRange: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          recordKey: "MK-201",
          marketId: "MK-201",
          personCode: "090",
          personName: "杜丽沙",
          settleNo: "XF2603220000",
          handCardCode: "",
          roomCode: "V02",
          itemId: "ITEM-TEA-1",
          itemName: "乌龙茶",
          itemTypeName: "饮品",
          itemCategory: 3,
          salesCode: "807",
          salesName: "杨晓婉",
          count: 1,
          afterDisc: 18,
          commission: 3,
          settleTime: "2026-03-22 11:14:18",
          bizDate: "2026-03-22",
          rawJson: "{}",
        },
        {
          orgId: "1001",
          recordKey: "MK-202",
          marketId: "MK-202",
          personCode: "090",
          personName: "杜丽沙",
          settleNo: "XF2603280001",
          handCardCode: "",
          roomCode: "V05",
          itemId: "ITEM-OIL-1",
          itemName: "薰衣草精油",
          itemTypeName: "商品",
          itemCategory: 3,
          salesCode: "807",
          salesName: "杨晓婉",
          count: 1,
          afterDisc: 38,
          commission: 6,
          settleTime: "2026-03-28 20:15:00",
          bizDate: "2026-03-28",
          rawJson: "{}",
        },
      ]),
    };

    const profile = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yiwu",
        employeeName: "义乌店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1001"],
      },
      text: "义乌店尾号7500客户画像",
      now,
    });
    const teaPreference = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yiwu",
        employeeName: "义乌店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1001"],
      },
      text: "义乌店尾号7500常买什么茶饮",
      now,
    });

    expect(profile.text).toContain("韩*");
    expect(profile.text).toContain("一句话判断");
    expect(profile.text).toContain("当前状态");
    expect(profile.text).toContain("顾客价值");
    expect(profile.text).toContain("偏好与习惯");
    expect(profile.text).toContain("风险与机会");
    expect(profile.text).not.toContain("今日先抓");
    expect(profile.text).toContain("客户等级：A级高价值");
    expect(profile.text).toContain("生命周期：活跃复购期");
    expect(profile.text).toContain(
      "近30/90天节奏：近30天 3 次 / 780.00 元；近90天 6 次 / 1680.00 元。",
    );
    expect(profile.text).toContain("经营分层：高价值稳态");
    expect(profile.text).toContain("偏好技师：杜丽沙");
    expect(profile.text).toContain("偏好项目：荷悦SPA");
    expect(profile.text).toContain("常来时段：晚场");
    expect(profile.text).toContain("茶饮偏好：乌龙茶 1 次 18.00 元");
    expect(profile.text).toContain("副项偏好：薰衣草精油 1 次 38.00 元");
    expect(profile.text).toContain("沉默风险：低");
    expect(profile.text).toContain("预计复购概率：高（近30天有到店、项目与技师偏好稳定）");
    expect(teaPreference.text).toContain("乌龙茶");
    expect(teaPreference.text).not.toContain("今日先抓");
    expect(runtime.listCustomerTechLinksByDateRange).toHaveBeenCalledTimes(2);
    expect(runtime.listCustomerTechLinks).not.toHaveBeenCalled();

    runtime.findCurrentMembersByPhoneSuffix.mockResolvedValueOnce([
      {
        orgId: "1001",
        memberId: "member-han",
        name: "韩先生",
        phone: "18503727500",
        storedAmount: 1280,
        consumeAmount: 4680,
        createdTime: "2026-01-01",
        lastConsumeTime: "2026-03-28",
        silentDays: 3,
        rawJson: "{}",
      },
      {
        orgId: "1001",
        memberId: "member-li",
        name: "李女士",
        phone: "13688887500",
        storedAmount: 860,
        consumeAmount: 3180,
        createdTime: "2026-01-05",
        lastConsumeTime: "2026-03-26",
        silentDays: 5,
        rawJson: "{}",
      },
    ]);

    const ambiguous = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yiwu",
        employeeName: "义乌店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1001"],
      },
      text: "义乌店尾号7500客户画像",
      now,
    });

    expect(ambiguous.text).toContain("匹配到 2 位会员");
    expect(ambiguous.text).toContain("韩*");
    expect(ambiguous.text).toContain("李*");
  });

  it("does not treat service market rows as addon preferences and explains tea gaps honestly", async () => {
    const runtime = {
      ...buildRuntime({
        reports: {
          "1005:2026-04-05": buildReport({
            orgId: "1005",
            storeName: "迎宾店",
            bizDate: "2026-04-05",
          }),
        },
      }),
      findCurrentMembersByPhoneSuffix: vi.fn().mockResolvedValue([
        {
          orgId: "1005",
          memberId: "member-yan",
          name: "严女士",
          phone: "13900009775",
          storedAmount: 4000,
          consumeAmount: 12860,
          createdTime: "2025-12-01",
          lastConsumeTime: "2026-04-05",
          silentDays: 1,
          rawJson: "{}",
        },
      ]),
      listCurrentMemberCards: vi.fn().mockResolvedValue([
        {
          orgId: "1005",
          memberId: "member-yan",
          cardId: "card-yan",
          cardNo: "yb9775",
          rawJson: "{}",
        },
      ]),
      listConsumeBillsByDateRange: vi.fn().mockResolvedValue([
        {
          orgId: "1005",
          settleId: "S-9775",
          settleNo: "XF2604050008",
          payAmount: 598,
          consumeAmount: 598,
          discountAmount: 0,
          antiFlag: false,
          optTime: "2026-04-05 21:32:00",
          bizDate: "2026-04-05",
          rawJson: JSON.stringify({
            Infos: ["严女士 (金悦卡) [yb9775],消费598.00元;"],
            Payments: [{ Name: "会员", Amount: 598 }],
          }),
        },
      ]),
      listCustomerSegments: vi.fn().mockResolvedValue([
        buildCustomerSegment({
          bizDate: "2026-04-05",
          customerIdentityKey: "member:member-yan",
          customerDisplayName: "严女士",
          memberId: "member-yan",
          memberCardNo: "yb9775",
          referenceCode: "yb9775",
          primarySegment: "important-value-member",
          recencySegment: "active-7d",
          paymentSegment: "member-only",
          techLoyaltySegment: "single-tech-loyal",
          visitCount30d: 2,
          visitCount90d: 4,
          payAmount30d: 598,
          payAmount90d: 1386,
          topTechCode: "021",
          topTechName: "李红儿",
          topTechVisitCount90d: 3,
          topTechVisitShare90d: 0.75,
        }),
      ]),
      listCustomerProfile90dByDateRange: vi.fn().mockResolvedValue([
        buildCustomerProfile90dRow({
          orgId: "1005",
          windowEndBizDate: "2026-04-05",
          memberId: "member-yan",
          payAmount30d: 598,
          payAmount90d: 1386,
          visitCount30d: 2,
          visitCount90d: 4,
          topTechName: "李红儿",
          currentStoredAmount: 4000,
          currentSilentDays: 1,
          currentLastConsumeTime: "2026-04-05",
        }),
      ]),
      listCustomerTechLinksByDateRange: vi.fn().mockResolvedValue([
        buildCustomerTechLink({
          bizDate: "2026-04-05",
          settleId: "S-9775",
          settleNo: "XF2604050008",
          customerIdentityKey: "member:member-yan",
          customerDisplayName: "严女士",
          memberId: "member-yan",
          memberCardNo: "yb9775",
          referenceCode: "yb9775",
          techCode: "021",
          techName: "李红儿",
          techTurnover: 598,
          itemNames: ["禅悦SPA"],
        }),
      ]),
      listCustomerTechLinks: vi.fn().mockResolvedValue([]),
      listTechMarketByDateRange: vi.fn().mockResolvedValue([
        {
          orgId: "1005",
          recordKey: "MK-9775",
          marketId: "MK-9775",
          personCode: "021",
          personName: "李红儿",
          settleNo: "XF2604050008",
          handCardCode: "",
          roomCode: "V08",
          itemId: "ITEM-SPA-1",
          itemName: "禅悦SPA",
          itemTypeName: "理疗类",
          itemCategory: 1,
          salesCode: "801",
          salesName: "客服小王",
          count: 1,
          afterDisc: 598,
          commission: 120,
          settleTime: "2026-04-05 23:08:00",
          bizDate: "2026-04-05",
          rawJson: "{}",
        },
      ]),
    };

    const profile = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yingbin",
        employeeName: "迎宾店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1005"],
      },
      text: "迎宾店尾号9775客户画像",
      now,
    });
    const teaPreference = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yingbin",
        employeeName: "迎宾店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1005"],
      },
      text: "迎宾店尾号9775常买什么茶饮",
      now,
    });

    expect(profile.text).toContain("偏好项目：禅悦SPA");
    expect(profile.text).not.toContain("副项偏好：禅悦SPA");
    expect(profile.text).not.toContain("茶饮偏好：");
    expect(profile.text).not.toContain("餐食偏好：");
    expect(teaPreference.text).toContain(
      "当前已同步的1.7明细主要是服务项目或加钟记录，没有独立茶饮消费字段。",
    );
  });

  it("answers waterbar-related customer asks with settlement-level proxy signals instead of fake item names", async () => {
    const runtime = {
      ...buildRuntime({
        reports: {
          "1001:2026-04-05": buildReport({
            orgId: "1001",
            storeName: "义乌店",
            bizDate: "2026-04-05",
          }),
        },
      }),
      findCurrentMembersByPhoneSuffix: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          memberId: "member-han",
          name: "韩先生",
          phone: "18503727500",
          storedAmount: 1280,
          consumeAmount: 4680,
          createdTime: "2026-01-01",
          lastConsumeTime: "2026-03-30",
          silentDays: 6,
          rawJson: "{}",
        },
      ]),
      listCurrentMemberCards: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          memberId: "member-han",
          cardId: "card-001",
          cardNo: "yw7500",
          rawJson: "{}",
        },
      ]),
      listConsumeBillsByDateRange: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          settleId: "S-301",
          settleNo: "XF2603150009",
          payAmount: 25,
          consumeAmount: 25,
          discountAmount: 0,
          antiFlag: false,
          optTime: "2026-03-15 16:39:42",
          bizDate: "2026-03-15",
          rawJson: JSON.stringify({
            SettleId: "S-301",
            SettleNo: "XF2603150009",
            Payments: [{ Name: "微信", Amount: 25, PaymentType: 4 }],
            Infos: ["韩先生 (金悦卡) [yw7500],消费25.00元(积分+0);"],
            CName: "水吧",
            RoomCode: "806",
          }),
        },
        {
          orgId: "1001",
          settleId: "S-302",
          settleNo: "XF2603280001",
          payAmount: 298,
          consumeAmount: 298,
          discountAmount: 0,
          antiFlag: false,
          optTime: "2026-03-28 20:15:00",
          bizDate: "2026-03-28",
          rawJson: JSON.stringify({
            SettleId: "S-302",
            SettleNo: "XF2603280001",
            Payments: [{ Name: "会员", Amount: 298, PaymentType: 3 }],
            Infos: ["韩先生 (金悦卡) [yw7500],消费298.00元(积分+0);"],
            CName: "杨晓婉",
            RoomCode: "V05",
          }),
        },
      ]),
      listCustomerSegments: vi.fn().mockResolvedValue([
        buildCustomerSegment({
          bizDate: "2026-04-05",
          customerIdentityKey: "member:member-han",
          customerDisplayName: "韩先生",
          memberId: "member-han",
          memberCardNo: "yw7500",
          referenceCode: "yw7500",
          primarySegment: "important-value-member",
          recencySegment: "active-7d",
          paymentSegment: "mixed-member-nonmember",
          techLoyaltySegment: "single-tech-loyal",
          visitCount30d: 2,
          visitCount90d: 4,
          payAmount30d: 323,
          payAmount90d: 1380,
          topTechCode: "090",
          topTechName: "杜丽沙",
          topTechVisitCount90d: 3,
          topTechVisitShare90d: 0.75,
        }),
      ]),
      listCustomerProfile90dByDateRange: vi.fn().mockResolvedValue([
        buildCustomerProfile90dRow({
          orgId: "1001",
          windowEndBizDate: "2026-04-05",
          memberId: "member-han",
          payAmount30d: 323,
          payAmount90d: 1380,
          visitCount30d: 2,
          visitCount90d: 4,
          topTechName: "杜丽沙",
          currentStoredAmount: 1280,
          currentSilentDays: 6,
          currentLastConsumeTime: "2026-03-30",
        }),
      ]),
      listCustomerTechLinksByDateRange: vi.fn().mockResolvedValue([
        buildCustomerTechLink({
          bizDate: "2026-03-28",
          settleId: "S-302",
          settleNo: "XF2603280001",
          customerIdentityKey: "member:member-han",
          customerDisplayName: "韩先生",
          memberId: "member-han",
          memberCardNo: "yw7500",
          referenceCode: "yw7500",
          techCode: "090",
          techName: "杜丽沙",
          techTurnover: 298,
          itemNames: ["荷悦SPA"],
        }),
      ]),
      listCustomerTechLinks: vi.fn().mockResolvedValue([]),
      listTechMarketByDateRange: vi.fn().mockResolvedValue([]),
    };

    const profile = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yiwu",
        employeeName: "义乌店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1001"],
      },
      text: "义乌店尾号7500客户画像",
      now,
    });
    const waterbar = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yiwu",
        employeeName: "义乌店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1001"],
      },
      text: "义乌店尾号7500有水吧相关消费吗",
      now,
    });

    expect(profile.text).not.toContain("水吧相关消费：");
    expect(waterbar.text).toContain("水吧相关消费");
    expect(waterbar.text).toContain("近90天识别到水吧相关结算 1 次 / 25.00 元");
    expect(waterbar.text).toContain("最近一次 2026-03-15");
    expect(waterbar.text).toContain("常见房间：806 1 次");
    expect(waterbar.text).toContain("当前接口只返回水吧相关结算单，不返回具体茶饮或餐食商品名。");
  });

  it("answers technician profile questions with technician-specific profiling instead of generic metric fallback", async () => {
    const runtime = {
      buildReport: vi.fn(),
      listTechUpClockByDateRange: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          rowFingerprint: "clock-001",
          personCode: "091",
          personName: "白慧慧",
          settleNo: "XF2603280001",
          handCardCode: "H001",
          itemName: "五行足道",
          clockType: "点钟",
          count: 1,
          turnover: 298,
          comm: 88,
          ctime: "2026-03-28 20:05:00",
          settleTime: "2026-03-28 21:35:00",
          bizDate: "2026-03-28",
          rawJson: JSON.stringify({ ClockType: "点钟", AddClockType: "0" }),
        },
        {
          orgId: "1001",
          rowFingerprint: "clock-002",
          personCode: "091",
          personName: "白慧慧",
          settleNo: "XF2603270009",
          handCardCode: "H002",
          itemName: "五行足道",
          clockType: "点钟",
          count: 1,
          turnover: 268,
          comm: 78,
          ctime: "2026-03-27 19:10:00",
          settleTime: "2026-03-27 20:40:00",
          bizDate: "2026-03-27",
          rawJson: JSON.stringify({ ClockType: "点钟", AddClockType: "1" }),
        },
        {
          orgId: "1001",
          rowFingerprint: "clock-003",
          personCode: "091",
          personName: "白慧慧",
          settleNo: "XF2603220006",
          handCardCode: "H003",
          itemName: "禅悦SPA",
          clockType: "轮钟",
          count: 1,
          turnover: 398,
          comm: 118,
          ctime: "2026-03-22 18:15:00",
          settleTime: "2026-03-22 19:55:00",
          bizDate: "2026-03-22",
          rawJson: JSON.stringify({ ClockType: "轮钟", AddClockType: "0" }),
        },
      ]),
      listTechMarketByDateRange: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          recordKey: "MK-301",
          marketId: "MK-301",
          settleNo: "XF2603280001",
          handCardCode: "H001",
          roomCode: "A01",
          personCode: "091",
          personName: "白慧慧",
          itemId: "oil-1",
          itemName: "薰衣草精油",
          itemTypeName: "商品",
          itemCategory: 3,
          salesCode: "s-001",
          salesName: "白慧慧",
          count: 1,
          afterDisc: 38,
          commission: 8,
          settleTime: "2026-03-28 21:00:00",
          bizDate: "2026-03-28",
          rawJson: "{}",
        },
      ]),
      listCustomerTechLinks: vi.fn(
        async ({ bizDate }: { bizDate: string }) =>
          (
            ({
              "2026-03-22": [
                buildCustomerTechLink({
                  bizDate: "2026-03-22",
                  settleId: "S-501",
                  settleNo: "XF2603220006",
                  customerIdentityKey: "member:han",
                  customerDisplayName: "韩先生",
                  memberId: "member-han",
                  memberCardNo: "yw7500",
                  referenceCode: "yw7500",
                  techCode: "091",
                  techName: "白慧慧",
                  techTurnover: 398,
                  itemNames: ["禅悦SPA"],
                }),
              ],
              "2026-03-27": [
                buildCustomerTechLink({
                  bizDate: "2026-03-27",
                  settleId: "S-502",
                  settleNo: "XF2603270009",
                  customerIdentityKey: "member:zhou",
                  customerDisplayName: "周先生",
                  memberId: "member-zhou",
                  memberCardNo: "yw7511",
                  referenceCode: "yw7511",
                  techCode: "091",
                  techName: "白慧慧",
                  techTurnover: 268,
                  itemNames: ["五行足道"],
                }),
              ],
              "2026-03-28": [
                buildCustomerTechLink({
                  bizDate: "2026-03-28",
                  settleId: "S-503",
                  settleNo: "XF2603280001",
                  customerIdentityKey: "member:han",
                  customerDisplayName: "韩先生",
                  memberId: "member-han",
                  memberCardNo: "yw7500",
                  referenceCode: "yw7500",
                  techCode: "091",
                  techName: "白慧慧",
                  techTurnover: 298,
                  itemNames: ["五行足道"],
                }),
              ],
            }) satisfies Record<string, CustomerTechLinkRecord[]>
          )[bizDate] ?? [],
      ),
      listCustomerSegments: vi.fn().mockResolvedValue([
        buildCustomerSegment({
          bizDate: "2026-03-30",
          customerIdentityKey: "member:han",
          customerDisplayName: "韩先生",
          memberId: "member-han",
          primarySegment: "important-value-member",
        }),
        buildCustomerSegment({
          bizDate: "2026-03-30",
          customerIdentityKey: "member:zhou",
          customerDisplayName: "周先生",
          memberId: "member-zhou",
          primarySegment: "important-reactivation-member",
        }),
      ]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "义乌店 技师 白慧慧 的画像",
      now,
    });

    expect(result.text).toContain("义乌店 技师 白慧慧 画像");
    expect(result.text).toContain("查询窗口: 近30天");
    expect(result.text).toContain("核心画像: 点钟型技师");
    expect(result.text).toContain("上钟: 3 钟 / 3 单，点钟率 66.7%，加钟率 33.3%");
    expect(result.text).toContain("业绩: 服务营收 964.00 元，提成 284.00 元，推销营收 38.00 元");
    expect(result.text).toContain(
      "30天经营节奏: 服务 3 天，日均 1.0 单，日均营收 321.33 元，单钟产出 321.33 元",
    );
    expect(result.text).toContain("承接结构: 点钟 2 单，轮钟 1 单，加钟 1 单，副项渗透 3.9%");
    expect(result.text).toContain("高峰时段: 晚场 3 单 / 964.00 元");
    expect(result.text).toContain("顾客经营: 30天真实服务顾客 2 位，复购顾客 1 位");
    expect(result.text).toContain("顾客识别覆盖 3/3 单服务单");
    expect(result.text).toContain("户均服务 1.5 次");
    expect(result.text).toContain("服务顾客: 2 位，其中重要价值会员 1 位、重要唤回会员 1 位");
    expect(result.text).toContain("主打项目: 五行足道 2 次 566.00 元");
    expect(result.text).toContain("常服务顾客: 韩** 2 次，周** 1 次");
    expect(result.text).toContain("优劣势诊断");
    expect(result.text).toContain("经营等级: 强势型");
    expect(result.text).toContain("当前带教优先级: 先扩稳定顾客池，再放大高峰时段承接。");
    expect(result.text).toContain("优势: 点钟吸引力强、加钟承接不错、有副项推销能力");
    expect(result.text).toContain("短板: 当前稳定顾客池偏窄，仅沉淀 2 位顾客");
    expect(result.text).toContain("店长动作建议");
    expect(result.text).toContain("建议重点排班: 晚场优先，主接五行足道");
    expect(result.text).toContain(
      "建议训练重点: 继续放大点钟优势，顺手把副项和加钟联动话术固定下来。",
    );
    expect(result.text).toContain("建议管理动作: 继续稳住白慧慧的晚场承接，同时扩充稳定顾客池。");
  });

  it("prefers the SQL-backed 30-day technician summary while keeping detailed raw breakdowns", async () => {
    const runtime = {
      buildReport: vi.fn(),
      listTechProfile30dByDateRange: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          windowEndBizDate: "2026-03-30",
          techCode: "091",
          techName: "白慧慧",
          servedCustomerCount30d: 2,
          servedOrderCount30d: 3,
          serviceDayCount30d: 4,
          totalClockCount30d: 3,
          pointClockCount30d: 2,
          queueClockCount30d: 1,
          pointClockRate30d: 0.75,
          addClockRate30d: 0.5,
          turnover30d: 1200,
          commission30d: 360,
          marketRevenue30d: 120,
          activeDays30d: 4,
        },
      ]),
      listTechUpClockByDateRange: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          rowFingerprint: "clock-sql-1",
          personCode: "091",
          personName: "白慧慧",
          settleNo: "XF2603280001",
          handCardCode: "H001",
          itemName: "五行足道",
          clockType: "点钟",
          count: 1,
          turnover: 298,
          comm: 88,
          ctime: "2026-03-28 20:05:00",
          settleTime: "2026-03-28 21:35:00",
          bizDate: "2026-03-28",
          rawJson: JSON.stringify({ ClockType: "点钟", AddClockType: "0" }),
        },
        {
          orgId: "1001",
          rowFingerprint: "clock-sql-2",
          personCode: "091",
          personName: "白慧慧",
          settleNo: "XF2603270009",
          handCardCode: "H002",
          itemName: "五行足道",
          clockType: "点钟",
          count: 1,
          turnover: 268,
          comm: 78,
          ctime: "2026-03-27 19:10:00",
          settleTime: "2026-03-27 20:40:00",
          bizDate: "2026-03-27",
          rawJson: JSON.stringify({ ClockType: "点钟", AddClockType: "1" }),
        },
        {
          orgId: "1001",
          rowFingerprint: "clock-sql-3",
          personCode: "091",
          personName: "白慧慧",
          settleNo: "XF2603220006",
          handCardCode: "H003",
          itemName: "禅悦SPA",
          clockType: "轮钟",
          count: 1,
          turnover: 398,
          comm: 118,
          ctime: "2026-03-22 18:15:00",
          settleTime: "2026-03-22 19:55:00",
          bizDate: "2026-03-22",
          rawJson: JSON.stringify({ ClockType: "轮钟", AddClockType: "0" }),
        },
      ]),
      listTechMarketByDateRange: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          recordKey: "market-sql-1",
          marketId: "MK-301",
          settleNo: "XF2603280001",
          handCardCode: "H001",
          roomCode: "A01",
          personCode: "091",
          personName: "白慧慧",
          itemId: "oil-1",
          itemName: "薰衣草精油",
          itemTypeName: "商品",
          itemCategory: 3,
          salesCode: "s-001",
          salesName: "白慧慧",
          count: 1,
          afterDisc: 38,
          commission: 8,
          settleTime: "2026-03-28 21:00:00",
          bizDate: "2026-03-28",
          rawJson: "{}",
        },
      ]),
      listCustomerTechLinks: vi.fn(
        async ({ bizDate }: { bizDate: string }) =>
          (
            ({
              "2026-03-22": [
                buildCustomerTechLink({
                  bizDate: "2026-03-22",
                  settleId: "S-SQL-1",
                  settleNo: "XF2603220006",
                  customerIdentityKey: "member:han",
                  customerDisplayName: "韩先生",
                  memberId: "member-han",
                  techCode: "091",
                  techName: "白慧慧",
                  techTurnover: 398,
                  itemNames: ["禅悦SPA"],
                }),
              ],
              "2026-03-27": [
                buildCustomerTechLink({
                  bizDate: "2026-03-27",
                  settleId: "S-SQL-2",
                  settleNo: "XF2603270009",
                  customerIdentityKey: "member:zhou",
                  customerDisplayName: "周先生",
                  memberId: "member-zhou",
                  techCode: "091",
                  techName: "白慧慧",
                  techTurnover: 268,
                  itemNames: ["五行足道"],
                }),
              ],
              "2026-03-28": [
                buildCustomerTechLink({
                  bizDate: "2026-03-28",
                  settleId: "S-SQL-3",
                  settleNo: "XF2603280001",
                  customerIdentityKey: "member:han",
                  customerDisplayName: "韩先生",
                  memberId: "member-han",
                  techCode: "091",
                  techName: "白慧慧",
                  techTurnover: 298,
                  itemNames: ["五行足道"],
                }),
              ],
            }) satisfies Record<string, CustomerTechLinkRecord[]>
          )[bizDate] ?? [],
      ),
      listCustomerSegments: vi.fn().mockResolvedValue([]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "义乌店 技师 白慧慧 的画像",
      now,
    });

    expect(result.text).toContain("上钟: 3 钟 / 3 单，点钟率 75.0%，加钟率 50.0%");
    expect(result.text).toContain("业绩: 服务营收 1200.00 元，提成 360.00 元，推销营收 120.00 元");
    expect(result.text).toContain(
      "30天经营节奏: 服务 4 天，日均 0.8 单，日均营收 300.00 元，单钟产出 400.00 元",
    );
    expect(result.text).toContain("高峰时段: 晚场 3 单 / 964.00 元");
    expect(result.text).toContain("主打项目: 五行足道 2 次 566.00 元");
  });

  it("marks technician customer binding as pending instead of asserting zero customers when binding coverage is missing", async () => {
    const runtime = {
      buildReport: vi.fn(),
      listTechUpClockByDateRange: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          rowFingerprint: "clock-100",
          personCode: "820",
          personName: "白慧慧",
          settleNo: "XF2603280099",
          handCardCode: "H100",
          itemName: "荷韵足道",
          clockType: "轮钟",
          count: 1,
          turnover: 298,
          comm: 88,
          ctime: "2026-03-28 20:05:00",
          settleTime: "2026-03-28 21:35:00",
          bizDate: "2026-03-28",
          rawJson: JSON.stringify({ ClockType: "轮钟", AddClockType: "0" }),
        },
        {
          orgId: "1001",
          rowFingerprint: "clock-101",
          personCode: "820",
          personName: "白慧慧",
          settleNo: "XF2603270088",
          handCardCode: "H101",
          itemName: "禅悦SPA",
          clockType: "轮钟",
          count: 1,
          turnover: 398,
          comm: 118,
          ctime: "2026-03-27 18:15:00",
          settleTime: "2026-03-27 19:55:00",
          bizDate: "2026-03-27",
          rawJson: JSON.stringify({ ClockType: "轮钟", AddClockType: "0" }),
        },
      ]),
      listTechMarketByDateRange: vi.fn().mockResolvedValue([]),
      listCustomerTechLinks: vi.fn().mockResolvedValue([]),
      listCustomerSegments: vi.fn().mockResolvedValue([]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "义乌店 技师 白慧慧 的画像",
      now,
    });

    expect(result.text).toContain("服务顾客: 待补客户技师绑定数据，当前不下客户归属判断");
    expect(result.text).toContain("常服务顾客: 待补客户技师绑定数据");
    expect(result.text).toContain("经营等级: 待补判断");
    expect(result.text).toContain("当前带教优先级: 先补客户-技师绑定，再判断留客和复购归属。");
    expect(result.text).toContain("短板: 客户-技师绑定链路待补，暂时无法判断留客能力");
    expect(result.text).toContain("建议管理动作: 先补客户-技师绑定数据，再看留客与复购归属。");
  });

  it("does not treat a tiny linked-customer sample as the technician's full 30-day customer count", async () => {
    const techClockRows = Array.from({ length: 10 }, (_, index) => ({
      orgId: "1001",
      rowFingerprint: `clock-partial-${index + 1}`,
      personCode: "820",
      personName: "白慧慧",
      settleNo: `XF2603${String(index + 1).padStart(2, "0")}0001`,
      handCardCode: `H${index + 1}`,
      itemName: index % 2 === 0 ? "荷韵足道" : "禅悦SPA",
      clockType: index < 4 ? "点钟" : "轮钟",
      count: 1,
      turnover: 298 + index,
      comm: 88 + index,
      ctime: `2026-03-${String(index + 1).padStart(2, "0")} 20:05:00`,
      settleTime: `2026-03-${String(index + 1).padStart(2, "0")} 21:35:00`,
      bizDate: `2026-03-${String(index + 1).padStart(2, "0")}`,
      rawJson: JSON.stringify({ ClockType: index < 4 ? "点钟" : "轮钟", AddClockType: "0" }),
    }));
    const runtime = {
      buildReport: vi.fn(),
      listTechUpClockByDateRange: vi.fn().mockResolvedValue(techClockRows),
      listTechMarketByDateRange: vi.fn().mockResolvedValue([]),
      listCustomerTechLinks: vi.fn(
        async ({ bizDate }: { bizDate: string }) =>
          (
            ({
              "2026-03-01": [
                buildCustomerTechLink({
                  bizDate: "2026-03-01",
                  settleId: "S-P1",
                  settleNo: "XF2603010001",
                  customerIdentityKey: "member:han",
                  customerDisplayName: "韩先生",
                  memberId: "member-han",
                  techCode: "820",
                  techName: "白慧慧",
                  techTurnover: 298,
                }),
              ],
              "2026-03-02": [
                buildCustomerTechLink({
                  bizDate: "2026-03-02",
                  settleId: "S-P2",
                  settleNo: "XF2603020001",
                  customerIdentityKey: "member:zhou",
                  customerDisplayName: "周先生",
                  memberId: "member-zhou",
                  techCode: "820",
                  techName: "白慧慧",
                  techTurnover: 299,
                }),
              ],
            }) satisfies Record<string, CustomerTechLinkRecord[]>
          )[bizDate] ?? [],
      ),
      listCustomerSegments: vi.fn().mockResolvedValue([]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "义乌店 技师 白慧慧 的画像",
      now,
    });

    expect(result.text).toContain("上钟: 10 钟 / 10 单");
    expect(result.text).toContain(
      "30天经营节奏: 服务 10 天，日均 1.0 单，日均营收 302.50 元，单钟产出 302.50 元",
    );
    expect(result.text).toContain("承接结构: 点钟 4 单，轮钟 6 单，加钟 0 单，副项渗透 0.0%");
    expect(result.text).toContain("高峰时段: 晚场 10 单 / 3025.00 元");
    expect(result.text).toContain("顾客识别覆盖: 已识别 2 位顾客，覆盖 2/10 单服务单");
    expect(result.text).toContain(
      "服务顾客: 顾客识别覆盖不足，当前不把已识别样本当作30天总服务顾客数",
    );
    expect(result.text).toContain("常服务顾客: 顾客识别覆盖不足，暂不输出");
    expect(result.text).toContain("短板: 客户-技师绑定覆盖不足");
    expect(result.text).toContain("建议管理动作: 先补客户-技师绑定覆盖，再看留客与复购归属。");
  });

  it("rebuilds technician customer coverage from raw consume bills when historical marts are missing", async () => {
    const runtime = {
      buildReport: vi.fn(),
      listTechUpClockByDateRange: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          rowFingerprint: "clock-fallback-1",
          personCode: "091",
          personName: "白慧慧",
          settleNo: "XF2603280001",
          handCardCode: "H001",
          itemName: "五行足道",
          clockType: "点钟",
          count: 1,
          turnover: 298,
          comm: 88,
          ctime: "2026-03-28 20:05:00",
          settleTime: "2026-03-28 21:35:00",
          bizDate: "2026-03-28",
          rawJson: JSON.stringify({ ClockType: "点钟", AddClockType: "0" }),
        },
        {
          orgId: "1001",
          rowFingerprint: "clock-fallback-2",
          personCode: "091",
          personName: "白慧慧",
          settleNo: "XF2603270009",
          handCardCode: "H002",
          itemName: "五行足道",
          clockType: "点钟",
          count: 1,
          turnover: 268,
          comm: 78,
          ctime: "2026-03-27 19:10:00",
          settleTime: "2026-03-27 20:40:00",
          bizDate: "2026-03-27",
          rawJson: JSON.stringify({ ClockType: "点钟", AddClockType: "1" }),
        },
        {
          orgId: "1001",
          rowFingerprint: "clock-fallback-3",
          personCode: "091",
          personName: "白慧慧",
          settleNo: "XF2603220006",
          handCardCode: "H003",
          itemName: "禅悦SPA",
          clockType: "轮钟",
          count: 1,
          turnover: 398,
          comm: 118,
          ctime: "2026-03-22 18:15:00",
          settleTime: "2026-03-22 19:55:00",
          bizDate: "2026-03-22",
          rawJson: JSON.stringify({ ClockType: "轮钟", AddClockType: "0" }),
        },
      ]),
      listTechMarketByDateRange: vi.fn().mockResolvedValue([]),
      listCustomerTechLinks: vi.fn().mockResolvedValue([]),
      listCustomerSegments: vi.fn().mockResolvedValue([]),
      listCurrentMemberCards: vi.fn().mockResolvedValue([]),
      listConsumeBillsByDateRange: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          settleId: "S-501",
          settleNo: "XF2603220006",
          payAmount: 398,
          consumeAmount: 398,
          discountAmount: 0,
          antiFlag: false,
          optTime: "2026-03-22 19:55:00",
          bizDate: "2026-03-22",
          rawJson: JSON.stringify({
            Infos: ["韩先生 (金悦卡) [yw7500],消费398.00元(积分+0);"],
          }),
        },
        {
          orgId: "1001",
          settleId: "S-502",
          settleNo: "XF2603270009",
          payAmount: 268,
          consumeAmount: 268,
          discountAmount: 0,
          antiFlag: false,
          optTime: "2026-03-27 20:40:00",
          bizDate: "2026-03-27",
          rawJson: JSON.stringify({
            Infos: ["周先生 (金悦卡) [yw7511],消费268.00元(积分+0);"],
          }),
        },
        {
          orgId: "1001",
          settleId: "S-503",
          settleNo: "XF2603280001",
          payAmount: 298,
          consumeAmount: 298,
          discountAmount: 0,
          antiFlag: false,
          optTime: "2026-03-28 21:35:00",
          bizDate: "2026-03-28",
          rawJson: JSON.stringify({
            Infos: ["韩先生 (金悦卡) [yw7500],消费298.00元(积分+0);"],
          }),
        },
      ]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "义乌店 技师 白慧慧 的画像",
      now,
    });

    expect(result.text).toContain("服务顾客: 2 位，其中重要价值会员 0 位、重要唤回会员 0 位");
    expect(result.text).toContain("常服务顾客: 韩** 2 次，周** 1 次");
    expect(result.text).not.toContain("顾客识别覆盖不足");
  });

  it("returns an ambiguity notice instead of merging same-name scatter history", async () => {
    const runtime = {
      ...buildRuntime({
        reports: {
          "1001:2026-03-30": buildReport({
            orgId: "1001",
            storeName: "义乌店",
            bizDate: "2026-03-30",
          }),
        },
      }),
      listCurrentMembers: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          memberId: "member-han-scatter",
          name: "韩先生",
          phone: "18503727500",
          storedAmount: 0,
          consumeAmount: 0,
          createdTime: "2026-03-26",
          lastConsumeTime: "2026-03-26",
          silentDays: 4,
          rawJson: JSON.stringify({
            Id: "member-han-scatter",
            Name: "韩先生",
            Phone: "18503727500",
            Type: "散客",
          }),
        },
        {
          orgId: "1001",
          memberId: "member-han-vip",
          name: "韩先生",
          phone: "15203720363",
          storedAmount: 2000,
          consumeAmount: 349,
          createdTime: "2026-03-26",
          lastConsumeTime: "2026-03-26",
          silentDays: 4,
          rawJson: JSON.stringify({
            Id: "member-han-vip",
            Name: "韩先生",
            Phone: "15203720363",
            Type: "会员",
          }),
        },
      ]),
      findCurrentMembersByPhoneSuffix: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          memberId: "member-han-scatter",
          name: "韩先生",
          phone: "18503727500",
          storedAmount: 0,
          consumeAmount: 0,
          createdTime: "2026-03-26",
          lastConsumeTime: "2026-03-26",
          silentDays: 4,
          rawJson: JSON.stringify({
            Id: "member-han-scatter",
            Name: "韩先生",
            Phone: "18503727500",
            Type: "散客",
          }),
        },
      ]),
      listCurrentMemberCards: vi.fn().mockResolvedValue([]),
      listConsumeBillsByDateRange: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          settleId: "S-301",
          settleNo: "XF2603260037",
          payAmount: 399,
          consumeAmount: 469,
          discountAmount: 70,
          antiFlag: false,
          optTime: "2026-03-27 01:23:50",
          bizDate: "2026-03-26",
          rawJson: JSON.stringify({
            SettleId: "S-301",
            SettleNo: "XF2603260037",
            Payments: [{ Name: "会员", Amount: 399, PaymentType: 3 }],
            Infos: ["韩先生 (金悦卡) [yw668233],消费399.00元(积分+0);"],
          }),
        },
      ]),
      listCustomerTechLinks: vi.fn().mockResolvedValue([
        buildCustomerTechLink({
          bizDate: "2026-03-26",
          settleId: "S-301",
          settleNo: "XF2603260037",
          customerIdentityKey: "display-name:韩先生",
          customerDisplayName: "韩先生",
          memberId: undefined,
          memberCardNo: undefined,
          referenceCode: "yw668233",
          techCode: "090",
          techName: "杜丽沙",
          techTurnover: 399,
          itemNames: ["荷悦SPA"],
        }),
      ]),
      listTechMarketByDateRange: vi.fn().mockResolvedValue([]),
    };

    const profile = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "ZhangZhen",
        employeeName: "张震",
        role: "hq",
        isActive: true,
      },
      text: "义乌店尾号7500客户画像",
      now,
    });

    expect(profile.text).toContain("无法安全归并画像");
    expect(profile.text).toContain("存在同名会员");
    expect(profile.text).not.toContain("匹配到店 1 次");
    expect(profile.text).not.toContain("399.00 元");
  });

  it("does not trust an identity-unstable 90-day snapshot when same-name members are ambiguous", async () => {
    const runtime = {
      ...buildRuntime({
        reports: {
          "1001:2026-03-30": buildReport({
            orgId: "1001",
            storeName: "义乌店",
            bizDate: "2026-03-30",
          }),
        },
      }),
      listCurrentMembers: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          memberId: "member-han-scatter",
          name: "韩先生",
          phone: "18503727500",
          storedAmount: 0,
          consumeAmount: 0,
          createdTime: "2026-03-26",
          lastConsumeTime: "2026-03-26",
          silentDays: 4,
          rawJson: JSON.stringify({
            Id: "member-han-scatter",
            Name: "韩先生",
            Phone: "18503727500",
            Type: "散客",
          }),
        },
        {
          orgId: "1001",
          memberId: "member-han-vip",
          name: "韩先生",
          phone: "15203720363",
          storedAmount: 2000,
          consumeAmount: 349,
          createdTime: "2026-03-26",
          lastConsumeTime: "2026-03-26",
          silentDays: 4,
          rawJson: JSON.stringify({
            Id: "member-han-vip",
            Name: "韩先生",
            Phone: "15203720363",
            Type: "会员",
          }),
        },
      ]),
      findCurrentMembersByPhoneSuffix: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          memberId: "member-han-scatter",
          name: "韩先生",
          phone: "18503727500",
          storedAmount: 0,
          consumeAmount: 0,
          createdTime: "2026-03-26",
          lastConsumeTime: "2026-03-26",
          silentDays: 4,
          rawJson: JSON.stringify({
            Id: "member-han-scatter",
            Name: "韩先生",
            Phone: "18503727500",
            Type: "散客",
          }),
        },
      ]),
      listCurrentMemberCards: vi.fn().mockResolvedValue([]),
      listConsumeBillsByDateRange: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          settleId: "S-301",
          settleNo: "XF2603260037",
          payAmount: 399,
          consumeAmount: 469,
          discountAmount: 70,
          antiFlag: false,
          optTime: "2026-03-27 01:23:50",
          bizDate: "2026-03-26",
          rawJson: JSON.stringify({
            SettleId: "S-301",
            SettleNo: "XF2603260037",
            Payments: [{ Name: "会员", Amount: 399, PaymentType: 3 }],
            Infos: ["韩先生 (金悦卡) [yw668233],消费399.00元(积分+0);"],
          }),
        },
      ]),
      listCustomerProfile90dByDateRange: vi.fn().mockResolvedValue([
        buildCustomerProfile90dRow({
          orgId: "1001",
          memberId: "member-han-scatter",
          customerIdentityKey: "display-name:韩先生",
          customerIdentityType: "display-name",
          customerDisplayName: "韩先生",
          memberCardNo: undefined,
          referenceCode: "yw668233",
          phone: undefined,
          identityStable: false,
          windowEndBizDate: "2026-03-29",
          payAmount30d: 399,
          payAmount90d: 399,
          visitCount30d: 1,
          visitCount90d: 1,
          topTechName: "杜丽沙",
          currentStoredAmount: 0,
          currentLastConsumeTime: "2026-03-26 21:30:00",
          currentSilentDays: 4,
        }),
      ]),
      listCustomerTechLinksByDateRange: vi.fn().mockResolvedValue([]),
      listTechUpClockByDateRange: vi.fn().mockResolvedValue([]),
      listTechMarketByDateRange: vi.fn().mockResolvedValue([]),
    };

    const profile = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "ZhangZhen",
        employeeName: "张震",
        role: "hq",
        isActive: true,
      },
      text: "义乌店尾号7500客户画像",
      now,
    });

    expect(profile.text).toContain("无法安全归并画像");
    expect(profile.text).toContain("存在同名会员");
    expect(profile.text).not.toContain("近90天 1 次 / 399.00 元");
    expect(profile.text).not.toContain("偏好技师：杜丽沙");
  });

  it("ignores an identity-unstable 90-day snapshot even when the member match itself is unique", async () => {
    const runtime = {
      ...buildRuntime({
        reports: {
          "1001:2026-03-30": buildReport({
            orgId: "1001",
            storeName: "义乌店",
            bizDate: "2026-03-30",
          }),
        },
      }),
      findCurrentMembersByPhoneSuffix: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          memberId: "member-wang",
          name: "王女士",
          phone: "18503729799",
          storedAmount: 0,
          consumeAmount: 88,
          createdTime: "2026-03-26",
          lastConsumeTime: "2026-03-29 19:30:00",
          silentDays: 1,
          rawJson: "{}",
        },
      ]),
      listCurrentMemberCards: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          memberId: "member-wang",
          cardId: "card-9799",
          cardNo: "yw9799",
          rawJson: "{}",
        },
      ]),
      listConsumeBillsByDateRange: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          settleId: "S-9799-1",
          settleNo: "XF2603290099",
          payAmount: 88,
          consumeAmount: 88,
          discountAmount: 0,
          antiFlag: false,
          optTime: "2026-03-29 19:30:00",
          bizDate: "2026-03-29",
          rawJson: JSON.stringify({
            SettleId: "S-9799-1",
            SettleNo: "XF2603290099",
            Payments: [{ Name: "微信", Amount: 88, PaymentType: 4 }],
            Infos: ["王女士 (金悦卡) [yw9799],消费88.00元;"],
          }),
        },
      ]),
      listCustomerProfile90dByDateRange: vi.fn().mockResolvedValue([
        buildCustomerProfile90dRow({
          orgId: "1001",
          memberId: "member-wang",
          customerDisplayName: "王女士",
          memberCardNo: "yw9799",
          referenceCode: "yw9799",
          phone: "18503729799",
          identityStable: false,
          payAmount30d: 880,
          payAmount90d: 1680,
          visitCount30d: 3,
          visitCount90d: 6,
          topTechName: "错误技师",
          currentStoredAmount: 980,
          currentLastConsumeTime: "2026-03-29 19:30:00",
          currentSilentDays: 1,
        }),
      ]),
      listCustomerTechLinksByDateRange: vi.fn().mockResolvedValue([]),
      listTechUpClockByDateRange: vi.fn().mockResolvedValue([]),
      listTechMarketByDateRange: vi.fn().mockResolvedValue([]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yiwu",
        employeeName: "义乌店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1001"],
      },
      text: "义乌店尾号9799客户画像",
      now,
    });

    expect(result.text).toContain("义乌店 尾号9799 客户画像");
    expect(result.text).toContain("经营分层：基础维护");
    expect(result.text).toContain("近30/90天节奏：近30天 1 次 / 88.00 元；近90天 1 次 / 88.00 元。");
    expect(result.text).not.toContain("错误技师");
    expect(result.text).not.toContain("1680.00 元");
  });

  it("ignores identity-unstable segment rows when rendering a phone-suffix customer profile", async () => {
    const runtime = {
      ...buildRuntime({
        reports: {
          "1001:2026-03-30": buildReport({
            orgId: "1001",
            storeName: "义乌店",
            bizDate: "2026-03-30",
          }),
        },
        customerSegments: {
          "1001:2026-03-30": [
            buildCustomerSegment({
              orgId: "1001",
              memberId: "member-wang",
              customerDisplayName: "王女士",
              memberCardNo: "yw9799",
              referenceCode: "yw9799",
              identityStable: false,
              primarySegment: "important-value-member",
              paymentSegment: "member-only",
              techLoyaltySegment: "single-tech-loyal",
              topTechName: "错误技师",
              payAmount30d: 880,
              payAmount90d: 1680,
              visitCount30d: 3,
              visitCount90d: 6,
              tagKeys: ["important-value-member", "single-tech-loyal"],
            }),
          ],
        },
      }),
      findCurrentMembersByPhoneSuffix: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          memberId: "member-wang",
          name: "王女士",
          phone: "18503729799",
          storedAmount: 0,
          consumeAmount: 88,
          createdTime: "2026-03-26",
          lastConsumeTime: "2026-03-29 19:30:00",
          silentDays: 1,
          rawJson: "{}",
        },
      ]),
      listCurrentMemberCards: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          memberId: "member-wang",
          cardId: "card-9799",
          cardNo: "yw9799",
          rawJson: "{}",
        },
      ]),
      listConsumeBillsByDateRange: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          settleId: "S-9799-2",
          settleNo: "XF2603290199",
          payAmount: 88,
          consumeAmount: 88,
          discountAmount: 0,
          antiFlag: false,
          optTime: "2026-03-29 19:30:00",
          bizDate: "2026-03-29",
          rawJson: JSON.stringify({
            SettleId: "S-9799-2",
            SettleNo: "XF2603290199",
            Payments: [{ Name: "微信", Amount: 88, PaymentType: 4 }],
            Infos: ["王女士 (金悦卡) [yw9799],消费88.00元;"],
          }),
        },
      ]),
      listCustomerProfile90dByDateRange: vi.fn().mockResolvedValue([]),
      listCustomerTechLinksByDateRange: vi.fn().mockResolvedValue([]),
      listTechUpClockByDateRange: vi.fn().mockResolvedValue([]),
      listTechMarketByDateRange: vi.fn().mockResolvedValue([]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yiwu",
        employeeName: "义乌店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1001"],
      },
      text: "义乌店尾号9799客户画像",
      now,
    });

    expect(result.text).toContain("经营分层：基础维护");
    expect(result.text).toContain("近30/90天节奏：近30天 1 次 / 88.00 元；近90天 1 次 / 88.00 元。");
    expect(result.text).not.toContain("错误技师");
    expect(result.text).not.toContain("高价值稳态");
  });

  it("ignores identity-unstable customer tech links and falls back to raw tech rows", async () => {
    const runtime = {
      ...buildRuntime({
        reports: {
          "1001:2026-03-30": buildReport({
            orgId: "1001",
            storeName: "义乌店",
            bizDate: "2026-03-30",
          }),
        },
      }),
      findCurrentMembersByPhoneSuffix: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          memberId: "member-wang",
          name: "王女士",
          phone: "18503729799",
          storedAmount: 0,
          consumeAmount: 88,
          createdTime: "2026-03-26",
          lastConsumeTime: "2026-03-29 19:30:00",
          silentDays: 1,
          rawJson: "{}",
        },
      ]),
      listCurrentMemberCards: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          memberId: "member-wang",
          cardId: "card-9799",
          cardNo: "yw9799",
          rawJson: "{}",
        },
      ]),
      listConsumeBillsByDateRange: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          settleId: "S-9799-3",
          settleNo: "XF2603290299",
          payAmount: 88,
          consumeAmount: 88,
          discountAmount: 0,
          antiFlag: false,
          optTime: "2026-03-29 19:30:00",
          bizDate: "2026-03-29",
          rawJson: JSON.stringify({
            SettleId: "S-9799-3",
            SettleNo: "XF2603290299",
            Payments: [{ Name: "微信", Amount: 88, PaymentType: 4 }],
            Infos: ["王女士 (金悦卡) [yw9799],消费88.00元;"],
          }),
        },
      ]),
      listCustomerProfile90dByDateRange: vi.fn().mockResolvedValue([]),
      listCustomerTechLinksByDateRange: vi.fn().mockResolvedValue([
        buildCustomerTechLink({
          bizDate: "2026-03-29",
          settleId: "S-9799-3",
          settleNo: "XF2603290299",
          customerIdentityKey: "member:member-wang",
          customerDisplayName: "王女士",
          memberId: "member-wang",
          memberCardNo: "yw9799",
          referenceCode: "yw9799",
          identityStable: false,
          techCode: "bad-001",
          techName: "错误技师",
          techTurnover: 88,
          itemNames: ["错误项目"],
        }),
      ]),
      listTechUpClockByDateRange: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          rowFingerprint: "up-9799-1",
          personCode: "090",
          personName: "杜丽沙",
          settleNo: "XF2603290299",
          handCardCode: "A08",
          itemName: "荷悦SPA",
          clockType: "2",
          count: 1,
          turnover: 88,
          comm: 30,
          ctime: "2026-03-29 19:00:00",
          settleTime: "2026-03-29 19:30:00",
          bizDate: "2026-03-29",
          rawJson: "{}",
        },
      ]),
      listTechMarketByDateRange: vi.fn().mockResolvedValue([]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yiwu",
        employeeName: "义乌店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1001"],
      },
      text: "义乌店尾号9799客户画像",
      now,
    });

    expect(result.text).toContain("偏好技师：杜丽沙");
    expect(result.text).toContain("偏好项目：荷悦SPA");
    expect(result.text).not.toContain("错误技师");
    expect(result.text).not.toContain("错误项目");
  });

  it("uses stronger reactivation advice for high silent-risk members", async () => {
    const runtime = {
      ...buildRuntime({
        reports: {
          "1001:2026-03-30": buildReport({
            orgId: "1001",
            storeName: "义乌店",
            bizDate: "2026-03-30",
          }),
        },
        customerSegments: {
          "1001:2026-03-30": [
            buildCustomerSegment({
              bizDate: "2026-03-30",
              customerIdentityKey: "member:member-reactivate",
              customerDisplayName: "赵女士",
              memberId: "member-reactivate",
              memberCardNo: "yw4567",
              referenceCode: "yw4567",
              lastBizDate: "2026-02-15",
              daysSinceLastVisit: 44,
              visitCount30d: 0,
              visitCount90d: 2,
              payAmount30d: 0,
              payAmount90d: 536,
              memberPayAmount90d: 536,
              topTechCode: "091",
              topTechName: "白慧慧",
              topTechVisitCount90d: 2,
              topTechVisitShare90d: 1,
              recencySegment: "silent-31-90d",
              frequencySegment: "low-1",
              monetarySegment: "medium-300-999",
              paymentSegment: "member-only",
              techLoyaltySegment: "single-tech-loyal",
              primarySegment: "important-reactivation-member",
              tagKeys: ["important-reactivation-member"],
            }),
          ],
        },
      }),
      findCurrentMembersByPhoneSuffix: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          memberId: "member-reactivate",
          name: "赵女士",
          phone: "13600004567",
          storedAmount: 980,
          consumeAmount: 2380,
          createdTime: "2025-12-20",
          lastConsumeTime: "2026-02-15",
          silentDays: 44,
          rawJson: "{}",
        },
      ]),
      listCurrentMemberCards: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          memberId: "member-reactivate",
          cardId: "card-4567",
          cardNo: "yw4567",
          rawJson: "{}",
        },
      ]),
      listConsumeBillsByDateRange: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          settleId: "S-401",
          settleNo: "XF2602150008",
          payAmount: 268,
          consumeAmount: 268,
          discountAmount: 0,
          antiFlag: false,
          optTime: "2026-02-15 19:45:00",
          bizDate: "2026-02-15",
          rawJson: JSON.stringify({
            SettleId: "S-401",
            SettleNo: "XF2602150008",
            Payments: [{ Name: "会员", Amount: 268, PaymentType: 3 }],
            Infos: ["赵女士 (金悦卡) [yw4567],消费268.00元;"],
          }),
        },
      ]),
      listCustomerTechLinks: vi.fn().mockResolvedValue([
        buildCustomerTechLink({
          bizDate: "2026-02-15",
          settleId: "S-401",
          settleNo: "XF2602150008",
          customerIdentityKey: "member:member-reactivate",
          customerDisplayName: "赵女士",
          memberId: "member-reactivate",
          memberCardNo: "yw4567",
          referenceCode: "yw4567",
          techCode: "091",
          techName: "白慧慧",
          techTurnover: 268,
          itemNames: ["五行足道"],
        }),
      ]),
      listTechMarketByDateRange: vi.fn().mockResolvedValue([]),
    };

    const profile = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yiwu",
        employeeName: "义乌店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1001"],
      },
      text: "义乌店尾号4567客户画像",
      now,
    });

    expect(profile.text).toContain("一句话判断");
    expect(profile.text).toContain("经营分层：高价值待唤回");
    expect(profile.text).toContain("经营标签：高价值待唤回、沉默风险高、技师偏好稳定");
    expect(profile.text).toContain("近30/90天节奏：");
    expect(profile.text).toContain("偏好技师：白慧慧");
    expect(profile.text).toContain("偏好项目：五行足道");
    expect(profile.text).not.toContain("茶饮偏好：");
    expect(profile.text).not.toContain("餐食偏好：");
    expect(profile.text).not.toContain("副项偏好：");
    expect(profile.text).toContain("沉默风险：高");
    expect(profile.text).toContain("预计复购概率：低（已进入重点唤回窗口，需靠人工回访拉回）");
    expect(profile.text).not.toContain("今日先抓");
  });

  it("prefers the SQL-backed 90-day customer snapshot and renders groupbuy conversion chain in customer profiles", async () => {
    const now = new Date("2026-04-04T10:00:00+08:00");
    const runtime = {
      ...buildRuntime({
        reports: {
          "1001:2026-03-30": buildReport({
            orgId: "1001",
            storeName: "义乌店",
            bizDate: "2026-03-30",
          }),
        },
        customerSegments: {
          "1001:2026-03-30": [
            buildCustomerSegment({
              bizDate: "2026-03-30",
              customerIdentityKey: "member:member-lin",
              customerDisplayName: "林女士",
              memberId: "member-lin",
              memberCardNo: "yw6608",
              referenceCode: "yw6608",
              payAmount90d: 620,
              payAmount30d: 260,
              visitCount90d: 3,
              visitCount30d: 1,
              primarySegment: "groupbuy-retain-candidate",
              paymentSegment: "groupbuy-only",
              topTechName: "安妮",
            }),
          ],
        },
        customerProfileRows: {
          "1001:2026-03-29:2026-03-31": [
            {
              orgId: "1001",
              windowEndBizDate: "2026-03-30",
              customerIdentityKey: "member:member-lin",
              customerIdentityType: "member",
              customerDisplayName: "林女士",
              memberId: "member-lin",
              memberCardNo: "yw6608",
              referenceCode: "yw6608",
              memberLabel: "金悦卡",
              phone: "18503726608",
              identityStable: true,
              segmentEligible: true,
              firstBizDate: "2026-03-01",
              lastBizDate: "2026-03-28",
              daysSinceLastVisit: 12,
              visitCount30d: 3,
              visitCount90d: 5,
              payAmount30d: 860,
              payAmount90d: 1680,
              memberPayAmount90d: 1260,
              groupbuyAmount90d: 420,
              directPayAmount90d: 0,
              distinctTechCount90d: 1,
              topTechCode: "091",
              topTechName: "安妮",
              topTechVisitCount90d: 4,
              topTechVisitShare90d: 0.8,
              recencySegment: "active-30d",
              frequencySegment: "high-4-plus",
              monetarySegment: "high-1000-plus",
              paymentSegment: "mixed-member-nonmember",
              techLoyaltySegment: "single-tech-loyal",
              primarySegment: "important-value-member",
              tagKeys: ["important-value-member", "single-tech-loyal"],
              currentStoredAmount: 1880,
              currentConsumeAmount: 4200,
              currentCreatedTime: "2026-03-03 10:00:00",
              currentLastConsumeTime: "2026-03-28 20:16:00",
              currentSilentDays: 12,
              firstGroupbuyBizDate: "2026-03-01",
              revisitWithin7d: true,
              revisitWithin30d: true,
              cardOpenedWithin7d: true,
              storedValueConvertedWithin7d: true,
              memberPayConvertedWithin30d: true,
              highValueMemberWithin30d: true,
            },
          ],
        },
      }),
      findCurrentMembersByPhoneSuffix: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          memberId: "member-lin",
          name: "林女士",
          phone: "18503726608",
          storedAmount: 520,
          consumeAmount: 960,
          createdTime: "2026-03-03 10:00:00",
          lastConsumeTime: "2026-03-10 09:00:00",
          silentDays: 25,
          rawJson: "{}",
        },
      ]),
      listCurrentMemberCards: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          memberId: "member-lin",
          cardId: "card-6608",
          cardNo: "yw6608",
          rawJson: "{}",
        },
      ]),
      listConsumeBillsByDateRange: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          settleId: "S-6608-1",
          settleNo: "XF2603286608",
          payAmount: 298,
          consumeAmount: 298,
          discountAmount: 0,
          antiFlag: false,
          optTime: "2026-03-28 20:16:00",
          bizDate: "2026-03-28",
          rawJson: JSON.stringify({
            SettleId: "S-6608-1",
            SettleNo: "XF2603286608",
            Payments: [{ Name: "会员", Amount: 298, PaymentType: 3 }],
            Infos: ["林女士 (金悦卡) [yw6608],消费298.00元;"],
          }),
        },
      ]),
      listCustomerTechLinksByDateRange: vi.fn().mockResolvedValue([
        buildCustomerTechLink({
          bizDate: "2026-03-28",
          settleId: "S-6608-1",
          settleNo: "XF2603286608",
          customerIdentityKey: "member:member-lin",
          customerDisplayName: "林女士",
          memberId: "member-lin",
          memberCardNo: "yw6608",
          referenceCode: "yw6608",
          techCode: "091",
          techName: "安妮",
          techTurnover: 298,
          itemNames: ["五行足道"],
        }),
      ]),
      listCustomerTechLinks: vi.fn().mockResolvedValue([]),
      listTechMarketByDateRange: vi.fn().mockResolvedValue([]),
    };

    const profile = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yiwu",
        employeeName: "义乌店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1001"],
      },
      text: "义乌店尾号6608客户画像",
      now,
    });

    expect(profile.text).toContain("当前状态");
    expect(profile.text).toContain("储值余额 1880.00 元｜最近到店 2026-03-28 20:16:00｜沉默 12 天");
    expect(profile.text).toContain(
      "近30/90天节奏：近30天 3 次 / 860.00 元；近90天 5 次 / 1680.00 元。",
    );
    expect(profile.text).toContain("经营分层：高价值稳态");
    expect(profile.text).toContain(
      "团购承接：首次团购 2026-03-01，7天复到店已接住，7天开卡已接住，7天储值已转化，30天会员消费已转化，30天高价值会员已形成",
    );
  });

  it("answers birthday-member asks from member raw payloads and 90-day snapshots", async () => {
    const now = new Date("2026-04-05T10:00:00+08:00");
    const runtime = {
      ...buildRuntime({
        reports: {
          "1003:2026-04-04": buildReport({
            orgId: "1003",
            storeName: "华美店",
            bizDate: "2026-04-04",
          }),
        },
      }),
      listCurrentMembers: vi.fn().mockResolvedValue([
        {
          orgId: "1003",
          memberId: "vip-1",
          name: "赵女士",
          phone: "13800001111",
          storedAmount: 2680,
          consumeAmount: 5420,
          createdTime: "2025-11-01 10:00:00",
          lastConsumeTime: "2026-01-03 18:10:00",
          silentDays: 91,
          rawStoreName: "华美店",
          rawJson: JSON.stringify({
            Birthday: "1990-04-05",
            Labels: ["高价值", "老客"],
          }),
        },
        {
          orgId: "1003",
          memberId: "vip-2",
          name: "李女士",
          phone: "13800002222",
          storedAmount: 680,
          consumeAmount: 980,
          createdTime: "2026-02-01 10:00:00",
          lastConsumeTime: "2026-03-20 18:10:00",
          silentDays: 15,
          rawStoreName: "华美店",
          rawJson: JSON.stringify({
            Birthday: "1989-04-05",
          }),
        },
      ]),
      listCustomerProfile90dByDateRange: vi.fn().mockResolvedValue([
        {
          orgId: "1003",
          windowEndBizDate: "2026-04-04",
          customerIdentityKey: "member:vip-1",
          customerIdentityType: "member",
          customerDisplayName: "赵女士",
          memberId: "vip-1",
          memberCardNo: "hm001",
          referenceCode: "hm001",
          memberLabel: "钻卡",
          phone: "13800001111",
          identityStable: true,
          segmentEligible: true,
          firstBizDate: "2025-11-01",
          lastBizDate: "2026-01-03",
          daysSinceLastVisit: 91,
          visitCount30d: 0,
          visitCount90d: 4,
          payAmount30d: 0,
          payAmount90d: 1260,
          memberPayAmount90d: 1260,
          groupbuyAmount90d: 0,
          directPayAmount90d: 0,
          distinctTechCount90d: 1,
          topTechCode: "T008",
          topTechName: "白慧慧",
          topTechVisitCount90d: 4,
          topTechVisitShare90d: 1,
          recencySegment: "sleeping-91-180d",
          frequencySegment: "high-4-plus",
          monetarySegment: "high-1000-plus",
          paymentSegment: "member-only",
          techLoyaltySegment: "single-tech-loyal",
          primarySegment: "important-reactivation-member",
          tagKeys: ["important-reactivation-member"],
          currentStoredAmount: 2680,
          currentConsumeAmount: 5420,
          currentCreatedTime: "2025-11-01 10:00:00",
          currentLastConsumeTime: "2026-01-03 18:10:00",
          currentSilentDays: 91,
          firstGroupbuyBizDate: undefined,
          revisitWithin7d: false,
          revisitWithin30d: false,
          cardOpenedWithin7d: false,
          storedValueConvertedWithin7d: false,
          memberPayConvertedWithin30d: false,
          highValueMemberWithin30d: false,
        },
      ]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-huamei",
        employeeName: "华美店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1003"],
      },
      text: "华美店今天过生日的高价值会员有哪些",
      now,
    });

    expect(result.text).toContain("华美店今天生日会员名单");
    expect(result.text).toContain("赵女士");
    expect(result.text).toContain("高价值待唤回");
    expect(result.text).toContain("储值 2680.00 元");
    expect(result.text).toContain("沉默 91 天");
  });

  it("prefers reactivation queue ordering for birthday recall asks when queue is available", async () => {
    const now = new Date("2026-04-05T10:00:00+08:00");
    const runtime = {
      ...buildRuntime({
        reports: {
          "1003:2026-04-04": buildReport({
            orgId: "1003",
            storeName: "华美店",
            bizDate: "2026-04-04",
          }),
        },
        memberReactivationQueue: {
          "1003:2026-04-04": [
            {
              orgId: "1003",
              bizDate: "2026-04-04",
              memberId: "vip-2",
              customerIdentityKey: "member:vip-2",
              customerDisplayName: "李女士",
              memberCardNo: "hm002",
              referenceCode: "hm002",
              primarySegment: "important-reactivation-member",
              followupBucket: "high-value-reactivation",
              reactivationPriorityScore: 720,
              strategyPriorityScore: 910,
              executionPriorityScore: 970,
              priorityBand: "P0",
              priorityRank: 1,
              churnRiskLabel: "critical",
              churnRiskScore: 0.85,
              revisitWindowLabel: "due-now",
              recommendedActionLabel: "immediate-1to1",
              recommendedTouchWeekday: "sunday",
              recommendedTouchDaypart: "afternoon",
              touchWindowLabel: "best-this-week",
              reasonSummary: "已沉默66天，近90天消费1680.00元，1天后生日。",
              touchAdviceSummary: "建议周日 afternoon 联系，本周命中较好窗口。",
              daysSinceLastVisit: 66,
              visitCount90d: 4,
              payAmount90d: 1680,
              currentStoredBalanceInferred: 980,
              projectedBalanceDaysLeft: 41,
              birthdayMonthDay: "04-06",
              nextBirthdayBizDate: "2026-04-06",
              birthdayWindowDays: 2,
              birthdayBoostScore: 60,
              topTechName: "白慧慧",
              queueJson: "{}",
              updatedAt: "2026-04-04T23:00:00+08:00",
            },
            {
              orgId: "1003",
              bizDate: "2026-04-04",
              memberId: "vip-1",
              customerIdentityKey: "member:vip-1",
              customerDisplayName: "赵女士",
              memberCardNo: "hm001",
              referenceCode: "hm001",
              primarySegment: "important-reactivation-member",
              followupBucket: "high-value-reactivation",
              reactivationPriorityScore: 760,
              strategyPriorityScore: 940,
              executionPriorityScore: 940,
              priorityBand: "P1",
              priorityRank: 2,
              churnRiskLabel: "critical",
              churnRiskScore: 0.88,
              revisitWindowLabel: "due-now",
              recommendedActionLabel: "immediate-1to1",
              recommendedTouchWeekday: "sunday",
              recommendedTouchDaypart: "after-work",
              touchWindowLabel: "best-this-week",
              reasonSummary: "已沉默91天，近90天消费1260.00元。",
              touchAdviceSummary: "建议周日 after-work 联系，本周命中较好窗口。",
              daysSinceLastVisit: 91,
              visitCount90d: 4,
              payAmount90d: 1260,
              currentStoredBalanceInferred: 2680,
              projectedBalanceDaysLeft: 60,
              birthdayMonthDay: "04-06",
              nextBirthdayBizDate: "2026-04-06",
              birthdayWindowDays: 2,
              birthdayBoostScore: 0,
              topTechName: "白慧慧",
              queueJson: "{}",
              updatedAt: "2026-04-04T23:00:00+08:00",
            },
          ],
        },
      }),
      listCurrentMembers: vi.fn().mockResolvedValue([
        {
          orgId: "1003",
          memberId: "vip-1",
          name: "赵女士",
          phone: "13800001111",
          storedAmount: 2680,
          consumeAmount: 5420,
          createdTime: "2025-11-01 10:00:00",
          lastConsumeTime: "2026-01-03 18:10:00",
          silentDays: 91,
          rawStoreName: "华美店",
          rawJson: JSON.stringify({
            Birthday: "1990-04-06",
          }),
        },
        {
          orgId: "1003",
          memberId: "vip-2",
          name: "李女士",
          phone: "13800002222",
          storedAmount: 980,
          consumeAmount: 1980,
          createdTime: "2025-08-01 10:00:00",
          lastConsumeTime: "2026-01-29 18:10:00",
          silentDays: 66,
          rawStoreName: "华美店",
          rawJson: JSON.stringify({
            Birthday: "1989-04-06",
          }),
        },
      ]),
      listCustomerProfile90dByDateRange: vi.fn().mockResolvedValue([]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-huamei",
        employeeName: "华美店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1003"],
      },
      text: "华美店未来7天最值得先跟进的生日会员有哪些",
      now,
    });

    expect(result.text).toContain("华美店未来7天生日会员名单");
    expect(result.text).toContain("P0");
    expect(result.text).toContain("1天后生日");
    expect(result.text.indexOf("1. 李女士")).toBeGreaterThan(-1);
    expect(result.text.indexOf("2. 赵女士")).toBeGreaterThan(-1);
    expect(result.text.indexOf("1. 李女士")).toBeLessThan(result.text.indexOf("2. 赵女士"));
  });

  it("explains birthday zero-result cases with coverage and filter context", async () => {
    const runtime = {
      ...buildRuntime({ reports: {} }),
      listCurrentMembers: vi.fn().mockResolvedValue([
        {
          orgId: "1003",
          memberId: "vip-1",
          name: "赵女士",
          phone: "13800001111",
          storedAmount: 0,
          consumeAmount: 420,
          createdTime: "2026-01-01 10:00:00",
          lastConsumeTime: "2026-04-03 18:10:00",
          silentDays: 2,
          rawStoreName: "华美店",
          rawJson: JSON.stringify({
            Birthday: "1990-04-11",
          }),
        },
        {
          orgId: "1003",
          memberId: "vip-2",
          name: "王女士",
          phone: "13800002222",
          storedAmount: 0,
          consumeAmount: 0,
          createdTime: "2026-01-01 10:00:00",
          lastConsumeTime: "2026-04-01 10:00:00",
          silentDays: 4,
          rawStoreName: "华美店",
          rawJson: JSON.stringify({}),
        },
      ]),
      listCustomerProfile90dByDateRange: vi.fn().mockResolvedValue([]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-huamei",
        employeeName: "华美店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1003"],
      },
      text: "华美店未来7天哪些生日会员最近90天没来店",
      now: new Date("2026-04-05T10:00:00+08:00"),
    });

    expect(result.text).toContain("华美店未来7天生日会员名单");
    expect(result.text).toContain("当前没有符合条件的会员");
    expect(result.text).toContain("生日字段已录入 1/2");
    expect(result.text).toContain("未来7天内命中 1 位生日会员");
    expect(result.text).toContain("最近90天未到店");
  });

  it("answers wait-experience asks from up-clock raw payloads", async () => {
    const runtime = {
      ...buildRuntime({
        reports: {
          "1005:2026-03-29": buildReport({
            orgId: "1005",
            storeName: "迎宾店",
            bizDate: "2026-03-29",
          }),
        },
      }),
      listTechUpClockByDateRange: vi.fn().mockResolvedValue([
        {
          orgId: "1005",
          rowFingerprint: "wait-1",
          personCode: "T001",
          personName: "技师甲",
          settleNo: "NO-1",
          handCardCode: "A08",
          itemName: "足疗",
          clockType: "2",
          count: 1,
          turnover: 298,
          comm: 88,
          ctime: "2026-03-29 13:05:00",
          settleTime: "2026-03-29 13:40:00",
          bizDate: "2026-03-29",
          rawJson: JSON.stringify({
            WaitTime: 18,
            RoomCode: "A08",
            ClockType: 2,
            Duration: 70,
          }),
        },
        {
          orgId: "1005",
          rowFingerprint: "wait-2",
          personCode: "T002",
          personName: "技师乙",
          settleNo: "NO-2",
          handCardCode: "B02",
          itemName: "SPA",
          clockType: "1",
          count: 1,
          turnover: 338,
          comm: 98,
          ctime: "2026-03-29 20:15:00",
          settleTime: "2026-03-29 20:40:00",
          bizDate: "2026-03-29",
          rawJson: JSON.stringify({
            WaitTime: 42,
            RoomCode: "B02",
            ClockType: 1,
            Duration: 90,
          }),
        },
      ]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yingbin",
        employeeName: "迎宾店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1005"],
      },
      text: "迎宾店昨天平均等待时长多少分钟",
      now,
    });

    expect(result.text).toContain("迎宾店昨天等待体验");
    expect(result.text).toContain("平均等待时长: 30.0 分钟");
    expect(result.text).toContain("最长等待时段: 晚场");
    expect(result.text).toContain("等待最高技师: 技师乙");
    expect(result.text).toContain("点钟/排钟等待");
  });

  it("derives wait minutes from timestamp-style WaitTime and STime fields", async () => {
    const runtime = {
      ...buildRuntime({
        reports: {
          "1005:2026-04-04": buildReport({
            orgId: "1005",
            storeName: "迎宾店",
            bizDate: "2026-04-04",
          }),
        },
      }),
      listTechUpClockByDateRange: vi.fn().mockResolvedValue([
        {
          orgId: "1005",
          rowFingerprint: "wait-ts-1",
          personCode: "T001",
          personName: "技师甲",
          settleNo: "NO-1",
          handCardCode: "A08",
          itemName: "足疗",
          clockType: "2",
          count: 1,
          turnover: 298,
          comm: 88,
          ctime: "2026-04-04 20:45:20",
          settleTime: "2026-04-04 22:36:57",
          bizDate: "2026-04-04",
          rawJson: JSON.stringify({
            WaitTime: "2026-04-04 20:45:20",
            STime: "2026-04-04 20:54:00",
            ETime: "2026-04-04 22:36:57",
            RoomCode: "V06",
            ClockType: 1,
            Duration: 100,
          }),
        },
        {
          orgId: "1005",
          rowFingerprint: "wait-ts-2",
          personCode: "T002",
          personName: "技师乙",
          settleNo: "NO-2",
          handCardCode: "B02",
          itemName: "SPA",
          clockType: "1",
          count: 1,
          turnover: 338,
          comm: 98,
          ctime: "2026-04-04 21:03:40",
          settleTime: "2026-04-04 23:00:39",
          bizDate: "2026-04-04",
          rawJson: JSON.stringify({
            WaitTime: "2026-04-04 21:03:40",
            STime: "2026-04-04 21:18:06",
            ETime: "2026-04-04 23:00:39",
            RoomCode: "V10",
            ClockType: 1,
            Duration: 100,
          }),
        },
      ]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yingbin",
        employeeName: "迎宾店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1005"],
      },
      text: "迎宾店昨天哪个时段等待最长",
      now: new Date("2026-04-05T10:00:00+08:00"),
    });

    expect(result.text).toContain("迎宾店昨天等待体验");
    expect(result.text).toContain("平均等待时长: 11.6 分钟");
    expect(result.text).toContain("最长等待时段: 晚场");
    expect(result.text).toContain("等待最高技师: 技师乙");
  });

  it("answers arrival-by-time-slot asks from consume bills across a cross-midnight window", async () => {
    const runtime = {
      ...buildRuntime({
        reports: {
          "1005:2026-03-29": buildReport({
            orgId: "1005",
            storeName: "迎宾店",
            bizDate: "2026-03-29",
          }),
        },
      }),
      listConsumeBillsByDateRange: vi.fn().mockResolvedValue([
        {
          orgId: "1005",
          settleId: "arrive-1",
          settleNo: "NO-A1",
          payAmount: 128,
          consumeAmount: 128,
          discountAmount: 0,
          antiFlag: false,
          optTime: "2026-03-23 14:20:00",
          bizDate: "2026-03-23",
          rawJson: JSON.stringify({ SettleId: "arrive-1" }),
        },
        {
          orgId: "1005",
          settleId: "arrive-2",
          settleNo: "NO-A2",
          payAmount: 158,
          consumeAmount: 158,
          discountAmount: 0,
          antiFlag: false,
          optTime: "2026-03-23 20:05:00",
          bizDate: "2026-03-23",
          rawJson: JSON.stringify({ SettleId: "arrive-2" }),
        },
        {
          orgId: "1005",
          settleId: "arrive-3",
          settleNo: "NO-A3",
          payAmount: 168,
          consumeAmount: 168,
          discountAmount: 0,
          antiFlag: false,
          optTime: "2026-03-24 20:35:00",
          bizDate: "2026-03-24",
          rawJson: JSON.stringify({ SettleId: "arrive-3" }),
        },
        {
          orgId: "1005",
          settleId: "arrive-4",
          settleNo: "NO-A4",
          payAmount: 188,
          consumeAmount: 188,
          discountAmount: 0,
          antiFlag: false,
          optTime: "2026-03-24 21:10:00",
          bizDate: "2026-03-24",
          rawJson: JSON.stringify({ SettleId: "arrive-4" }),
        },
        {
          orgId: "1005",
          settleId: "arrive-5",
          settleNo: "NO-A5",
          payAmount: 208,
          consumeAmount: 208,
          discountAmount: 0,
          antiFlag: false,
          optTime: "2026-03-25 01:15:00",
          bizDate: "2026-03-24",
          rawJson: JSON.stringify({ SettleId: "arrive-5" }),
        },
        {
          orgId: "1005",
          settleId: "arrive-6",
          settleNo: "NO-A6",
          payAmount: 218,
          consumeAmount: 218,
          discountAmount: 0,
          antiFlag: false,
          optTime: "2026-03-26 23:10:00",
          bizDate: "2026-03-26",
          rawJson: JSON.stringify({ SettleId: "arrive-6" }),
        },
        {
          orgId: "1005",
          settleId: "arrive-7",
          settleNo: "NO-A7",
          payAmount: 228,
          consumeAmount: 228,
          discountAmount: 0,
          antiFlag: false,
          optTime: "2026-03-27 01:35:00",
          bizDate: "2026-03-26",
          rawJson: JSON.stringify({ SettleId: "arrive-7" }),
        },
        {
          orgId: "1005",
          settleId: "arrive-8",
          settleNo: "NO-A8",
          payAmount: 238,
          consumeAmount: 238,
          discountAmount: 0,
          antiFlag: false,
          optTime: "2026-03-28 15:05:00",
          bizDate: "2026-03-28",
          rawJson: JSON.stringify({ SettleId: "arrive-8" }),
        },
      ]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yingbin",
        employeeName: "迎宾店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1005"],
      },
      text: "统计迎宾店过去一周每天平均各个时段到店的人数，从下午2点到晚上2点。",
      now,
    });

    expect(result.text).toContain("迎宾店过去一周到店时段分布");
    expect(result.text).toContain("统计窗口: 14:00-02:00");
    expect(result.text).toContain("峰值时段: 20:00-21:00");
    expect(result.text).toContain("20:00-21:00 0.29 人/天");
    expect(result.text).toContain("01:00-02:00 0.29 人/天");
  });

  it("answers member-source silent-risk asks from current member raw fields", async () => {
    const runtime = {
      ...buildRuntime({
        reports: {
          "1001:2026-03-30": buildReport({
            orgId: "1001",
            storeName: "义乌店",
            bizDate: "2026-03-30",
          }),
        },
      }),
      listCurrentMembers: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          memberId: "m-1",
          name: "团购客甲",
          phone: "13800001111",
          storedAmount: 2200,
          consumeAmount: 3800,
          createdTime: "2025-11-01 10:00:00",
          lastConsumeTime: "2026-01-01 20:00:00",
          silentDays: 95,
          rawStoreName: "义乌店",
          rawJson: JSON.stringify({
            From: "美团团购",
            MarketerName: "小赵",
            Labels: ["团购客", "女宾"],
          }),
        },
        {
          orgId: "1001",
          memberId: "m-2",
          name: "团购客乙",
          phone: "13800002222",
          storedAmount: 1800,
          consumeAmount: 2600,
          createdTime: "2026-01-10 10:00:00",
          lastConsumeTime: "2026-01-20 20:00:00",
          silentDays: 64,
          rawStoreName: "义乌店",
          rawJson: JSON.stringify({
            From: "美团团购",
            MarketerName: "小赵",
            Labels: ["团购客"],
          }),
        },
        {
          orgId: "1001",
          memberId: "m-3",
          name: "自然客甲",
          phone: "13800003333",
          storedAmount: 900,
          consumeAmount: 1500,
          createdTime: "2026-02-01 10:00:00",
          lastConsumeTime: "2026-03-25 20:00:00",
          silentDays: 5,
          rawStoreName: "义乌店",
          rawJson: JSON.stringify({
            From: "自然到店",
            MarketerName: "小王",
            Labels: ["老客"],
          }),
        },
      ]),
      listCustomerProfile90dByDateRange: vi.fn().mockResolvedValue([
        {
          ...buildCustomerProfile90dRow({
            orgId: "1001",
            memberId: "m-1",
            customerDisplayName: "团购客甲",
            windowEndBizDate: "2026-03-29",
            primarySegment: "important-reactivation-member",
            currentSilentDays: 95,
            currentStoredAmount: 2200,
          }),
        },
      ]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yiwu",
        employeeName: "义乌店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1001"],
      },
      text: "义乌店哪种来源的会员更容易沉默",
      now,
    });

    expect(result.text).toContain("义乌店当前会员来源沉默分析");
    expect(result.text).toContain("美团团购");
    expect(result.text).toContain("沉默30天占比 100.0%");
    expect(result.text).toContain("自然到店");
  });

  it("treats natural-language long-silent customer asks as the same customer follow-up capability", async () => {
    const runtime = buildRuntime({
      customerSegments: {
        "1001:2026-03-30": [
          buildCustomerSegment({
            orgId: "1001",
            bizDate: "2026-03-30",
            customerIdentityKey: "member:yiwu-zhou",
            customerDisplayName: "周先生",
            memberId: "member-yiwu-zhou",
            memberCardNo: "y001",
            referenceCode: "y001",
            primarySegment: "sleeping-customer",
            recencySegment: "silent-31-90d",
            daysSinceLastVisit: 66,
            payAmount90d: 1680,
            payAmount30d: 0,
            visitCount90d: 5,
            visitCount30d: 0,
            topTechName: "杜莎",
            topTechVisitCount90d: 4,
            topTechVisitShare90d: 0.8,
            tagKeys: ["important-reactivation-member", "single-tech-loyal"],
          }),
        ],
      },
    });

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yiwu",
        employeeName: "义乌店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1001"],
      },
      text: "义乌店哪些客人很久没来了",
      now,
    });

    expect(result.text).toContain("沉睡会员名单");
    expect(result.text).toContain("周先生");
  });

  it("answers add-on sales ranking phrasing through the tech ranking path", async () => {
    const runtime = buildRuntime({
      leaderboard: [
        {
          personCode: "T003",
          personName: "小李",
          totalClockCount: 15,
          upClockRecordCount: 14,
          pointClockRecordCount: 6,
          pointClockRate: 6 / 14,
          addClockRecordCount: 3,
          addClockRate: 3 / 14,
          turnover: 1600,
          commission: 480,
          commissionRate: 0.3,
          clockEffect: 106.67,
          marketRevenue: 180,
          marketCommission: 36,
        },
        {
          personCode: "T001",
          personName: "小王",
          totalClockCount: 18,
          upClockRecordCount: 17,
          pointClockRecordCount: 7,
          pointClockRate: 7 / 17,
          addClockRecordCount: 4,
          addClockRate: 4 / 17,
          turnover: 1900,
          commission: 570,
          commissionRate: 0.3,
          clockEffect: 111.76,
          marketRevenue: 320,
          marketCommission: 64,
        },
      ],
    });

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "义乌店今天谁推销做得好",
      now,
    });

    expect(result.text).toContain("义乌店 2026-03-31 技师推销营收排名");
    expect(result.text).toContain("1. 小王 320.00 元");
    expect(result.text).toContain("2. 小李 180.00 元");
  });

  it("answers realtime current-tech count and idle-list asks from 1.5 current snapshots", async () => {
    const runtime = {
      ...buildRuntime({
        reports: {},
      }),
      listCurrentTech: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          techCode: "T001",
          techName: "小王",
          isWork: true,
          isJob: true,
          pointClockNum: 2,
          wheelClockNum: 3,
          baseWages: 0,
          rawJson: JSON.stringify({
            PersonStateName: "上钟中",
            ItemList: [{ ItemTypeName: "足浴类", ItemName: "五行足道" }],
          }),
        },
        {
          orgId: "1001",
          techCode: "T002",
          techName: "小李",
          isWork: true,
          isJob: true,
          pointClockNum: 0,
          wheelClockNum: 0,
          baseWages: 0,
          rawJson: JSON.stringify({
            PersonStateName: "空闲",
            ItemList: [{ ItemTypeName: "按摩类", ItemName: "禅悦SPA" }],
          }),
        },
        {
          orgId: "1001",
          techCode: "T003",
          techName: "小张",
          isWork: true,
          isJob: true,
          pointClockNum: 0,
          wheelClockNum: 0,
          baseWages: 0,
          rawJson: JSON.stringify({
            PersonStateName: "待钟",
            ItemList: [{ ItemTypeName: "饮品", ItemName: "乌龙茶" }],
          }),
        },
      ]),
    };

    const onClockResult = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yiwu",
        employeeName: "义乌店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1001"],
      },
      text: "现在几个人在上钟",
      now,
    });
    const idleListResult = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "义乌店哪些技师现在有空",
      now,
    });

    expect(onClockResult.text).toContain("义乌店 2026-03-30 当前上钟中技师 1 人");
    expect(onClockResult.text).toContain("在岗技师 3 人");
    expect(idleListResult.text).toContain("义乌店 2026-03-30 当前技师状态");
    expect(idleListResult.text).toContain("小李 | 擅长 按摩类");
    expect(idleListResult.text).toContain("小张 | 擅长 饮品");
  });

  it("returns deterministic boundary replies for unsupported realtime queue and settlement asks", async () => {
    const runtime = {
      ...buildRuntime({ reports: {} }),
      listCurrentTech: vi.fn().mockResolvedValue([]),
    };

    const queueResult = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yiwu",
        employeeName: "义乌店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1001"],
      },
      text: "义乌店现在有客人在等位吗",
      now,
    });
    const settlementResult = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yiwu",
        employeeName: "义乌店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1001"],
      },
      text: "义乌店后台有几张待结账的单",
      now,
    });

    expect(queueResult.text).toContain("等位 / 候钟实时状态");
    expect(queueResult.text).toContain("上钟中技师人数、空闲技师名单");
    expect(settlementResult.text).toContain("待结账 / 待结算实时单据状态");
    expect(settlementResult.text).toContain("上钟中人数、空闲技师名单");
  });

  it("answers add-on item-breakdown asks through the dedicated market breakdown path", async () => {
    const runtime = {
      ...buildRuntime({
        reports: {
          "1001:2026-03-31": buildReport({
            orgId: "1001",
            storeName: "义乌店",
            bizDate: "2026-03-31",
          }),
        },
      }),
      listTechMarketByDateRange: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          recordKey: "m-1",
          personCode: "T001",
          personName: "小王",
          itemId: "i-1",
          itemName: "乌龙茶",
          itemTypeName: "饮品",
          itemCategory: 3,
          count: 2,
          afterDisc: 36,
          commission: 7.2,
          bizDate: "2026-03-31",
          rawJson: "{}",
        },
        {
          orgId: "1001",
          recordKey: "m-2",
          personCode: "T002",
          personName: "小李",
          itemId: "i-2",
          itemName: "薰衣草精油",
          itemTypeName: "商品",
          itemCategory: 3,
          count: 1,
          afterDisc: 38,
          commission: 7.6,
          bizDate: "2026-03-31",
          rawJson: "{}",
        },
      ]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "义乌店今天卖出什么副项了",
      now,
    });

    expect(result.text).toContain("义乌店 2026-03-31 副项销售明细");
    expect(result.text).toContain("总副项营收 74.00 元");
    expect(result.text).toContain("乌龙茶 2 单 36.00 元");
    expect(result.text).toContain("薰衣草精油 1 单 38.00 元");
    expect(result.text).toContain("小王 2 单 36.00 元");
  });

  it("answers tea-specific add-on asks through the same market breakdown path", async () => {
    const runtime = {
      ...buildRuntime({
        reports: {
          "1001:2026-03-31": buildReport({
            orgId: "1001",
            storeName: "义乌店",
            bizDate: "2026-03-31",
          }),
        },
      }),
      listTechMarketByDateRange: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          recordKey: "m-1",
          personCode: "T001",
          personName: "小王",
          itemId: "i-1",
          itemName: "乌龙茶",
          itemTypeName: "饮品",
          itemCategory: 3,
          count: 2,
          afterDisc: 36,
          commission: 7.2,
          bizDate: "2026-03-31",
          rawJson: "{}",
        },
        {
          orgId: "1001",
          recordKey: "m-2",
          personCode: "T002",
          personName: "小李",
          itemId: "i-2",
          itemName: "薰衣草精油",
          itemTypeName: "商品",
          itemCategory: 3,
          count: 1,
          afterDisc: 38,
          commission: 7.6,
          bizDate: "2026-03-31",
          rawJson: "{}",
        },
      ]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "义乌店今天茶饮卖了几单",
      now,
    });

    expect(result.text).toContain("义乌店 2026-03-31 茶饮销售明细");
    expect(result.text).toContain("乌龙茶 2 单 36.00 元");
    expect(result.text).not.toContain("薰衣草精油");
  });

  it("returns a comparison boundary when member source is only a single unresolved enum code", async () => {
    const runtime = {
      ...buildRuntime({
        reports: {
          "1001:2026-03-30": buildReport({
            orgId: "1001",
            storeName: "义乌店",
            bizDate: "2026-03-30",
          }),
        },
      }),
      listCurrentMembers: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          memberId: "m-1",
          name: "会员甲",
          phone: "13800001111",
          storedAmount: 1200,
          consumeAmount: 2200,
          createdTime: "2025-11-01 10:00:00",
          lastConsumeTime: "2026-01-01 20:00:00",
          silentDays: 95,
          rawStoreName: "义乌店",
          rawJson: JSON.stringify({ From: 1 }),
        },
        {
          orgId: "1001",
          memberId: "m-2",
          name: "会员乙",
          phone: "13800002222",
          storedAmount: 800,
          consumeAmount: 1200,
          createdTime: "2026-01-10 10:00:00",
          lastConsumeTime: "2026-03-20 20:00:00",
          silentDays: 10,
          rawStoreName: "义乌店",
          rawJson: JSON.stringify({ From: 1 }),
        },
      ]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yiwu",
        employeeName: "义乌店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1001"],
      },
      text: "义乌店哪种来源的会员更容易沉默",
      now,
    });

    expect(result.text).toContain("当前还不能严肃比较会员来源沉默");
    expect(result.text).toContain("来源编码 1");
  });

  it("answers coupon usage and expiry asks from the current member coupon snapshot", async () => {
    const runtime = {
      ...buildRuntime({
        reports: {
          "1005:2026-03-30": buildReport({
            orgId: "1005",
            storeName: "迎宾店",
            bizDate: "2026-03-30",
          }),
        },
      }),
      listCurrentMembers: vi.fn().mockResolvedValue([
        {
          orgId: "1005",
          memberId: "m-1",
          name: "张女士",
          phone: "13800001111",
          storedAmount: 800,
          consumeAmount: 1200,
          createdTime: "2026-02-01 10:00:00",
          lastConsumeTime: "2026-03-20 20:00:00",
          silentDays: 10,
          rawJson: JSON.stringify({
            Coupons: [
              { Name: "38元饮品券", IsUsed: true, ExpireTime: "2026-04-02 23:59:59", Source: "企微活动" },
              { Name: "88元加钟券", IsUsed: false, ExpireTime: "2026-04-03 23:59:59", Source: "企微活动" },
            ],
          }),
        },
        {
          orgId: "1005",
          memberId: "m-2",
          name: "李女士",
          phone: "13800002222",
          storedAmount: 500,
          consumeAmount: 900,
          createdTime: "2026-02-10 10:00:00",
          lastConsumeTime: "2026-03-18 20:00:00",
          silentDays: 12,
          rawJson: JSON.stringify({
            Coupons: [
              { Name: "38元饮品券", IsUsed: true, ExpireTime: "2026-04-01 23:59:59", Source: "企微活动" },
              { Name: "50元护理券", IsUsed: false, ExpireTime: "2026-04-05 23:59:59", Source: "小程序活动" },
            ],
          }),
        },
      ]),
      listCustomerProfile90dByDateRange: vi.fn().mockResolvedValue([]),
    };

    const usedResult = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yingbin",
        employeeName: "迎宾店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1005"],
      },
      text: "迎宾店上次发的券有多少人用了",
      now,
    });
    const expireResult = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yingbin",
        employeeName: "迎宾店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1005"],
      },
      text: "迎宾店还有多少券快过期了没用",
      now,
    });

    expect(usedResult.text).toContain("迎宾店 2026-03-30 当前会员券包使用快照");
    expect(usedResult.text).toContain("已用券 2 张");
    expect(usedResult.text).toContain("未用券 2 张");
    expect(expireResult.text).toContain("迎宾店 2026-03-30 当前会员券包临期快照");
    expect(expireResult.text).toContain("7天内快过期未用券 2 张");
    expect(expireResult.text).toContain("张女士 1 张");
  });

  it("answers marketer and label priority asks from current member raw fields", async () => {
    const runtime = {
      ...buildRuntime({
        reports: {
          "1001:2026-03-30": buildReport({
            orgId: "1001",
            storeName: "义乌店",
            bizDate: "2026-03-30",
          }),
        },
      }),
      listCurrentMembers: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          memberId: "m-1",
          name: "会员甲",
          phone: "13800001111",
          storedAmount: 2600,
          consumeAmount: 4200,
          createdTime: "2025-11-01 10:00:00",
          lastConsumeTime: "2026-01-01 20:00:00",
          silentDays: 95,
          rawStoreName: "义乌店",
          rawJson: JSON.stringify({
            From: "美团团购",
            MarketerName: "小赵",
            Labels: ["团购客", "高价值"],
          }),
        },
        {
          orgId: "1001",
          memberId: "m-2",
          name: "会员乙",
          phone: "13800002222",
          storedAmount: 1900,
          consumeAmount: 2800,
          createdTime: "2026-01-10 10:00:00",
          lastConsumeTime: "2026-01-20 20:00:00",
          silentDays: 64,
          rawStoreName: "义乌店",
          rawJson: JSON.stringify({
            From: "抖音团购",
            MarketerName: "小赵",
            Labels: ["团购客"],
          }),
        },
        {
          orgId: "1001",
          memberId: "m-3",
          name: "会员丙",
          phone: "13800003333",
          storedAmount: 680,
          consumeAmount: 900,
          createdTime: "2026-02-01 10:00:00",
          lastConsumeTime: "2026-03-26 20:00:00",
          silentDays: 4,
          rawStoreName: "义乌店",
          rawJson: JSON.stringify({
            From: "自然到店",
            MarketerName: "小王",
            Labels: ["老客"],
          }),
        },
      ]),
      listCustomerProfile90dByDateRange: vi.fn().mockResolvedValue([
        buildCustomerProfile90dRow({
          orgId: "1001",
          memberId: "m-1",
          customerDisplayName: "会员甲",
          windowEndBizDate: "2026-03-29",
          primarySegment: "important-reactivation-member",
          currentSilentDays: 95,
          currentStoredAmount: 2600,
        }),
      ]),
    };

    const marketerResult = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yiwu",
        employeeName: "义乌店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1001"],
      },
      text: "义乌店哪个营销人带来的会员储值更高",
      now,
    });
    const labelResult = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yiwu",
        employeeName: "义乌店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1001"],
      },
      text: "义乌店哪些标签会员最值得重点经营",
      now,
    });

    expect(marketerResult.text).toContain("义乌店当前营销人会员经营");
    expect(marketerResult.text).toContain("小赵");
    expect(marketerResult.text).toContain("总储值 4500.00 元");
    expect(labelResult.text).toContain("义乌店当前标签经营优先级");
    expect(labelResult.text).toContain("团购客");
    expect(labelResult.text).toContain("高价值");
  });

  it("returns a boundary when marketer attribution fields are empty", async () => {
    const runtime = {
      ...buildRuntime({
        reports: {
          "1001:2026-03-30": buildReport({
            orgId: "1001",
            storeName: "义乌店",
            bizDate: "2026-03-30",
          }),
        },
      }),
      listCurrentMembers: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          memberId: "m-1",
          name: "会员甲",
          phone: "13800001111",
          storedAmount: 1200,
          consumeAmount: 2200,
          createdTime: "2025-11-01 10:00:00",
          lastConsumeTime: "2026-01-01 20:00:00",
          silentDays: 95,
          rawStoreName: "义乌店",
          rawJson: JSON.stringify({ From: 1, MarketerName: "", MarketerCode: "", MarketerId: "" }),
        },
      ]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yiwu",
        employeeName: "义乌店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1001"],
      },
      text: "义乌店哪个营销人带来的会员储值更高",
      now,
    });

    expect(result.text).toContain("当前会员表里还没有营销归因字段");
    expect(result.text).toContain("不能严肃比较");
  });

  it("keeps coupon effect / return-to-store asks on the boundary answer", async () => {
    const runtime = {
      ...buildRuntime({
        reports: {
          "1005:2026-03-30": buildReport({
            orgId: "1005",
            storeName: "迎宾店",
            bizDate: "2026-03-30",
          }),
        },
      }),
      listCurrentMembers: vi.fn().mockResolvedValue([
        {
          orgId: "1005",
          memberId: "m-1",
          name: "张女士",
          phone: "13800001111",
          storedAmount: 800,
          consumeAmount: 1200,
          createdTime: "2026-02-01 10:00:00",
          lastConsumeTime: "2026-03-20 20:00:00",
          silentDays: 10,
          rawJson: JSON.stringify({
            Coupons: [
              { Name: "38元饮品券", IsUsed: true, ExpireTime: "2026-04-02 23:59:59", Source: "企微活动" },
            ],
          }),
        },
      ]),
      listCustomerProfile90dByDateRange: vi.fn().mockResolvedValue([]),
    };

    const usedResult = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yingbin",
        employeeName: "迎宾店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1005"],
      },
      text: "迎宾店近30天优惠券回店效果怎么样",
      now,
    });
    const expireResult = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yingbin",
        employeeName: "迎宾店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1005"],
      },
      text: "迎宾店近30天优惠券核销后回来效果怎么样",
      now,
    });

    expect(usedResult.text).toContain("迎宾店优惠券回店效果暂未接通");
    expect(expireResult.text).toContain("迎宾店优惠券回店效果暂未接通");
  });

  it("answers recharge-card-type asks from recharge raw payloads", async () => {
    const runtime = {
      ...buildRuntime({
        reports: {
          "1005:2026-03-29": buildReport({
            orgId: "1005",
            storeName: "迎宾店",
            bizDate: "2026-03-29",
          }),
        },
      }),
      listRechargeBillsByDateRange: vi.fn().mockResolvedValue([
        {
          orgId: "1005",
          rechargeId: "R-001",
          realityAmount: 1800,
          totalAmount: 2100,
          donateAmount: 300,
          antiFlag: false,
          optTime: "2026-03-12 12:00:00",
          bizDate: "2026-03-12",
          rawJson: JSON.stringify({
            CardTypeName: "金悦卡",
            Sales: "前台甲",
          }),
        },
        {
          orgId: "1005",
          rechargeId: "R-002",
          realityAmount: 1500,
          totalAmount: 1800,
          donateAmount: 300,
          antiFlag: false,
          optTime: "2026-03-21 18:00:00",
          bizDate: "2026-03-21",
          rawJson: JSON.stringify({
            CardTypeName: "金悦卡",
            Sales: "前台乙",
          }),
        },
        {
          orgId: "1005",
          rechargeId: "R-003",
          realityAmount: 900,
          totalAmount: 1000,
          donateAmount: 100,
          antiFlag: false,
          optTime: "2026-03-25 15:00:00",
          bizDate: "2026-03-25",
          rawJson: JSON.stringify({
            CardTypeName: "银悦卡",
            Sales: "前台甲",
          }),
        },
      ]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yingbin",
        employeeName: "迎宾店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1005"],
      },
      text: "迎宾店近30天哪种卡型充值最好",
      now,
    });

    expect(result.text).toContain("迎宾店近30天充值卡型结构");
    expect(result.text).toContain("金悦卡");
    expect(result.text).toContain("实充 3300.00 元");
    expect(result.text).toContain("赠送 600.00 元");
  });

  it("answers recharge-sales asks from recharge raw payloads", async () => {
    const runtime = {
      ...buildRuntime({
        reports: {
          "1005:2026-03-29": buildReport({
            orgId: "1005",
            storeName: "迎宾店",
            bizDate: "2026-03-29",
          }),
        },
      }),
      listRechargeBillsByDateRange: vi.fn().mockResolvedValue([
        {
          orgId: "1005",
          rechargeId: "R-001",
          realityAmount: 1600,
          totalAmount: 1900,
          donateAmount: 300,
          antiFlag: false,
          optTime: "2026-03-12 12:00:00",
          bizDate: "2026-03-12",
          rawJson: JSON.stringify({
            CardTypeName: "金悦卡",
            Sales: "前台甲",
          }),
        },
        {
          orgId: "1005",
          rechargeId: "R-002",
          realityAmount: 1000,
          totalAmount: 1100,
          donateAmount: 100,
          antiFlag: false,
          optTime: "2026-03-21 18:00:00",
          bizDate: "2026-03-21",
          rawJson: JSON.stringify({
            CardTypeName: "银悦卡",
            Sales: "前台甲",
          }),
        },
        {
          orgId: "1005",
          rechargeId: "R-003",
          realityAmount: 900,
          totalAmount: 1000,
          donateAmount: 100,
          antiFlag: false,
          optTime: "2026-03-25 15:00:00",
          bizDate: "2026-03-25",
          rawJson: JSON.stringify({
            CardTypeName: "金悦卡",
            Sales: "前台乙",
          }),
        },
      ]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yingbin",
        employeeName: "迎宾店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1005"],
      },
      text: "迎宾店近30天哪个客服带来的充值最多",
      now,
    });

    expect(result.text).toContain("迎宾店近30天充值客服归因");
    expect(result.text).toContain("前台甲");
    expect(result.text).toContain("实充 2600.00 元");
    expect(result.text).toContain("前台乙");
  });

  it("answers复购还是储值 tradeoff asks with a direct operating priority", async () => {
    const runtime = buildRuntime({
      reports: {
        "1005:2026-03-30": buildReport({
          orgId: "1005",
          storeName: "迎宾店",
          bizDate: "2026-03-30",
          metrics: {
            memberRepurchaseBaseCustomerCount7d: 42,
            memberRepurchaseReturnedCustomerCount7d: 14,
            memberRepurchaseRate7d: 14 / 42,
            sleepingMemberRate: 0.19,
            currentStoredBalance: 88_000,
            renewalPressureIndex30d: 1.08,
            storedBalanceLifeMonths: 4.1,
          },
        }),
      },
      storeSummary30dRows: {
        "1005:2026-03-30:2026-03-30": [
          buildStoreSummary30dRow({
            orgId: "1005",
            storeName: "迎宾店",
            windowEndBizDate: "2026-03-30",
            memberRepurchaseBaseCustomerCount7d: 42,
            memberRepurchaseReturnedCustomerCount7d: 14,
            memberRepurchaseRate7d: 14 / 42,
            sleepingMemberRate: 0.19,
            currentStoredBalance: 88_000,
            storedBalanceLifeMonths: 4.1,
            renewalPressureIndex30d: 1.08,
          }),
        ],
        "1005:2026-02-28:2026-02-28": [
          buildStoreSummary30dRow({
            orgId: "1005",
            storeName: "迎宾店",
            windowEndBizDate: "2026-02-28",
            memberRepurchaseBaseCustomerCount7d: 38,
            memberRepurchaseReturnedCustomerCount7d: 18,
            memberRepurchaseRate7d: 18 / 38,
            sleepingMemberRate: 0.14,
            currentStoredBalance: 86_000,
            storedBalanceLifeMonths: 4.3,
            renewalPressureIndex30d: 0.96,
          }),
        ],
      },
    });

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yingbin",
        employeeName: "迎宾店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1005"],
      },
      text: "迎宾店最近该先抓复购还是储值",
      now,
    });

    expect(result.text).toContain("迎宾店 当前更该先抓什么");
    expect(result.text).toContain("结论: 先抓复购和老客回流");
    expect(result.text).toContain("会员7日复购率 33.3%（14/42）");
    expect(result.text).toContain("沉默会员占比 19.0%");
    expect(result.text).toContain("今天先把上周到店但本周没回来的老会员拉名单");
  });

  it("renders the store diagnosis lens for open-ended single-store priority asks", async () => {
    const reports: Record<string, DailyStoreReport> = {};
    const bizDates = [
      "2026-03-24",
      "2026-03-25",
      "2026-03-26",
      "2026-03-27",
      "2026-03-28",
      "2026-03-29",
      "2026-03-30",
    ];
    for (const bizDate of bizDates) {
      reports[`1001:${bizDate}`] = buildReport({
        orgId: "1001",
        storeName: "义乌店",
        bizDate,
        metrics: {
          serviceRevenue: 9800 / 7,
          serviceOrderCount: 56 / 7,
          customerCount: 56 / 7,
          averageTicket: 128,
          totalClockCount: 38 / 7,
          addClockRate: 0.18,
          sleepingMemberRate: 0.19,
          renewalPressureIndex30d: 1.34,
          memberRepurchaseBaseCustomerCount7d: 42,
          memberRepurchaseReturnedCustomerCount7d: 10,
          memberRepurchaseRate7d: 10 / 42,
          groupbuy7dRevisitRate: 0.18,
          groupbuy7dStoredValueConversionRate: 0.08,
        },
        suggestions: [
          "今天先把上周到店但本周没回来的老会员拉名单，按高价值/普通两档分开打。",
          "前台和熟悉技师一起做二次邀约，先把人约回来，再谈续费和开卡。",
        ],
      });
    }

    const runtime = buildRuntime({
      reports,
    });

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yiwu",
        employeeName: "义乌店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1001"],
      },
      text: "义乌店近7天重点看什么",
      now,
    });

    expect(result.text).toContain("义乌店 近7天 当前重点看什么");
    expect(result.text).toContain("一、增长结论");
    expect(result.text).toContain("二、这家店先看什么");
    expect(result.text).toContain("1. 先看留存：");
    expect(result.text).toContain("2. 再看会员资产：");
    expect(result.text).toContain("3. 再看单客价值：");
    expect(result.text).toContain("4. 最后看拉新质量：");
    expect(result.text).toContain("三、店长今天先做什么");
    expect(result.text).toContain("四、结论");
    expect(result.text).toContain("会员7日复购率 23.8%（10/42）");
    expect(result.text).toContain("沉默会员占比 19.0%");
    expect(result.text).not.toContain("风险与建议");
    expect(runtime.buildReport).toHaveBeenCalled();
  });

  it("renders the COO operations lens for single-store execution priority asks", async () => {
    const reports: Record<string, DailyStoreReport> = {};
    const bizDates = [
      "2026-03-24",
      "2026-03-25",
      "2026-03-26",
      "2026-03-27",
      "2026-03-28",
      "2026-03-29",
      "2026-03-30",
    ];
    for (const bizDate of bizDates) {
      reports[`1001:${bizDate}`] = buildReport({
        orgId: "1001",
        storeName: "义乌店",
        bizDate,
        metrics: {
          serviceRevenue: 1500,
          serviceOrderCount: 22,
          customerCount: 20,
          averageTicket: 75,
          totalClockCount: 20,
          upClockRecordCount: 20,
          pointClockRecordCount: 6,
          pointClockRate: 0.3,
          addClockRecordCount: 3,
          addClockRate: 0.15,
          clockEffect: 75,
          roomOccupancyRate: 0.61,
          roomTurnoverRate: 2.2,
          activeTechCount: 5,
          onDutyTechCount: 9,
        },
      });
    }

    const runtime = buildRuntime({
      reports,
    });

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yiwu",
        employeeName: "义乌店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1001"],
      },
      text: "义乌店近7天重点看什么，点钟率、加钟率还是翻房率",
      now,
    });

    expect(result.text).toContain("义乌店 近7天 当前重点看什么");
    expect(result.text).toContain("一、运营结论");
    expect(result.text).toContain("二、这家店先盯的履约信号");
    expect(result.text).toContain("1. 先看承接效率：");
    expect(result.text).toContain("2. 再看二次成交：");
    expect(result.text).toContain("3. 再看产能利用：");
    expect(result.text).toContain("4. 最后看排班负荷：");
    expect(result.text).toContain("三、店长今天先调整什么");
    expect(result.text).toContain("点钟率 30.0%");
    expect(result.text).toContain("加钟率 15.0%");
    expect(runtime.buildReport).toHaveBeenCalled();
  });

  it("renders the CFO profit lens for single-store margin priority asks", async () => {
    const reports: Record<string, DailyStoreReport> = {};
    const bizDates = [
      "2026-03-24",
      "2026-03-25",
      "2026-03-26",
      "2026-03-27",
      "2026-03-28",
      "2026-03-29",
      "2026-03-30",
    ];
    for (const bizDate of bizDates) {
      reports[`1001:${bizDate}`] = buildReport({
        orgId: "1001",
        storeName: "义乌店",
        bizDate,
        metrics: {
          serviceRevenue: 1800,
          serviceOrderCount: 18,
          customerCount: 18,
          averageTicket: 100,
          grossMarginRate: 0.44,
          netMarginRate: 0.06,
          breakEvenRevenue: 12000,
          rechargeCash: 500,
          rechargeStoredValue: 680,
          storedConsumeAmount: 360,
          currentStoredBalance: 56000,
          storedBalanceLifeMonths: 1.8,
          renewalPressureIndex30d: 1.42,
        },
      });
    }

    const runtime = buildRuntime({
      reports,
    });

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yiwu",
        employeeName: "义乌店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1001"],
      },
      text: "义乌店近7天重点看什么，毛利率、净利率还是保本营收",
      now,
    });

    expect(result.text).toContain("义乌店 近7天 当前重点看什么");
    expect(result.text).toContain("一、利润结论");
    expect(result.text).toContain("二、这家店先盯的利润信号");
    expect(result.text).toContain("1. 先看利润空间：");
    expect(result.text).toContain("2. 再看保本安全垫：");
    expect(result.text).toContain("3. 再看储值现金流：");
    expect(result.text).toContain("4. 最后看会员资产寿命：");
    expect(result.text).toContain("三、店长今天先收哪一口利润");
    expect(result.text).toContain("毛利率 44.0%");
    expect(result.text).toContain("净利率 6.0%");
    expect(runtime.buildReport).toHaveBeenCalled();
  });

  it("uses semantic fallback intent when the rule layer cannot resolve a new but still supported question", async () => {
    const runtime = buildRuntime({
      reports: {
        "1001:2026-03-30": buildReport({
          orgId: "1001",
          storeName: "义乌店",
          bizDate: "2026-03-30",
        }),
      },
    });
    const fallbackIntent = {
      rawText: "义乌店昨天盘收咋样",
      kind: "metric" as const,
      explicitOrgIds: ["1001"],
      allStoresRequested: false,
      timeFrame: {
        kind: "single" as const,
        bizDate: "2026-03-30",
        label: "昨天",
        days: 1 as const,
      },
      metrics: [{ key: "serviceRevenue" as const, label: "服务营收" }],
      unsupportedMetrics: [],
      mentionsCompareKeyword: false,
      mentionsRankingKeyword: false,
      mentionsTrendKeyword: false,
      mentionsAnomalyKeyword: false,
      mentionsRiskKeyword: false,
      mentionsAdviceKeyword: false,
      mentionsReportKeyword: false,
      routeConfidence: "medium" as const,
      semanticSlots: {
        store: {
          scope: "single" as const,
          orgIds: ["1001"],
        },
        object: "store" as const,
        action: "metric" as const,
        metricKeys: ["serviceRevenue"],
        time: {
          kind: "single" as const,
          startBizDate: "2026-03-30",
          endBizDate: "2026-03-30",
          label: "昨天",
          days: 1,
        },
      },
    };
    (runtime as { resolveSemanticFallbackIntent?: unknown }).resolveSemanticFallbackIntent = vi
      .fn()
      .mockResolvedValue({
        intent: fallbackIntent,
      });

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "义乌店昨天盘收咋样",
      now,
    });

    expect(result.text).toContain("服务营收: 3200.00 元");
    expect(result.effectiveOrgIds).toEqual(["1001"]);
    expect(result.entry).toEqual({
      source: "ai_fallback",
      reason: "supported-unresolved-query",
    });
    expect(
      (runtime as { resolveSemanticFallbackIntent?: ReturnType<typeof vi.fn> })
        .resolveSemanticFallbackIntent,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "义乌店昨天盘收咋样",
      }),
    );
  });

  it("returns the semantic fallback clarification instead of the generic unmatched text", async () => {
    const runtime = buildRuntime({ reports: {} });
    (runtime as { resolveSemanticFallbackIntent?: unknown }).resolveSemanticFallbackIntent = vi
      .fn()
      .mockResolvedValue({
        clarificationText: "这句话里的门店范围还不够清楚，请先说具体门店或直接问五店全景。",
      });

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "这家店和五店一起看下最近情况",
      now,
    });

    expect(result.text).toBe("这句话里的门店范围还不够清楚，请先说具体门店或直接问五店全景。");
  });

  it("prefers deterministic missing-store clarification before invoking AI fallback", async () => {
    const runtime = buildRuntime({ reports: {} });
    (runtime as { resolveSemanticFallbackIntent?: unknown }).resolveSemanticFallbackIntent = vi
      .fn()
      .mockResolvedValue({
        clarificationText: "不应该先走 AI fallback。",
      });

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "昨天营收多少",
      now,
    });

    expect(result.text).toBe("你是看哪家店？比如：义乌店昨天营收多少。");
    expect(result.entry).toEqual({
      source: "rule_clarifier",
      reason: "missing-store",
    });
    expect(
      (runtime as { resolveSemanticFallbackIntent?: ReturnType<typeof vi.fn> })
        .resolveSemanticFallbackIntent,
    ).not.toHaveBeenCalled();
  });

  it("clarifies missing store scope before falling back to the old ambiguous multi-store message", async () => {
    const runtime = buildRuntime({ reports: {} });

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "昨天营收多少",
      now,
    });

    expect(result.text).toBe("你是看哪家店？比如：义乌店昨天营收多少。");
  });

  it("clarifies missing time for generic single-store performance asks instead of defaulting to one day", async () => {
    const runtime = buildRuntime({ reports: {} });

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "义乌店营收怎么样",
      now,
    });

    expect(result.text).toBe("你要看义乌店昨天、近7天还是近30天？");
  });

  it("answers Arabic all-store window metric status asks with a window ranking instead of store clarification", async () => {
    const runtime = {
      buildReport: vi.fn(),
      getCurrentServingVersion: vi.fn().mockResolvedValue("serving-v1"),
      executeCompiledServingQuery: vi.fn().mockResolvedValue([
        {
          org_id: "1003",
          store_name: "华美店",
          window_end_biz_date: "2026-03-30",
          window_days: 7,
          service_revenue: 12600,
          average_ticket: 138,
          sleeping_member_rate: 0.08,
          renewal_pressure_index_30d: 1.05,
          member_repurchase_rate_7d: 0.72,
          risk_score: 90,
        },
        {
          org_id: "1001",
          store_name: "义乌店",
          window_end_biz_date: "2026-03-30",
          window_days: 7,
          service_revenue: 9800,
          average_ticket: 132,
          sleeping_member_rate: 0.18,
          renewal_pressure_index_30d: 1.2,
          member_repurchase_rate_7d: 0.41,
          risk_score: 10,
        },
      ]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "5个店近一周的营收情况",
      now,
    });

    expect(result.text).toContain("2店 近7天 营收总览");
    expect(result.text).toContain("总营收 22400.00 元");
    expect(result.text).toContain("营收排名");
    expect(result.text).toContain("1. 华美店 12600.00 元");
    expect(result.text).toContain("2. 义乌店 9800.00 元");
    expect(result.text).toContain("头尾差 2800.00 元");
    expect(result.text).toContain("最该关注：义乌店");
    expect(result.text).toContain("原因：近7天营收最低，较头部门店少 2800.00 元。");
    expect(result.text).toContain("下周动作：先盯 义乌店 的客流承接和客单放大，优先把营收缺口补回来。");
    expect(result.text).not.toContain("你是看哪家店");
  });

  it("answers single-store window metric status asks with a trend instead of a single scalar", async () => {
    const runtime = buildRuntime({
      reports: {
        "1005:2026-03-24": buildReport({
          orgId: "1005",
          storeName: "迎宾店",
          bizDate: "2026-03-24",
          metrics: { serviceRevenue: 1000, totalClockCount: 30, clockEffect: 33.33 },
        }),
        "1005:2026-03-25": buildReport({
          orgId: "1005",
          storeName: "迎宾店",
          bizDate: "2026-03-25",
          metrics: { serviceRevenue: 1100, totalClockCount: 31, clockEffect: 35.48 },
        }),
        "1005:2026-03-26": buildReport({
          orgId: "1005",
          storeName: "迎宾店",
          bizDate: "2026-03-26",
          metrics: { serviceRevenue: 1200, totalClockCount: 32, clockEffect: 37.5 },
        }),
        "1005:2026-03-27": buildReport({
          orgId: "1005",
          storeName: "迎宾店",
          bizDate: "2026-03-27",
          metrics: { serviceRevenue: 1300, totalClockCount: 33, clockEffect: 39.39 },
        }),
        "1005:2026-03-28": buildReport({
          orgId: "1005",
          storeName: "迎宾店",
          bizDate: "2026-03-28",
          metrics: { serviceRevenue: 1400, totalClockCount: 34, clockEffect: 41.18 },
        }),
        "1005:2026-03-29": buildReport({
          orgId: "1005",
          storeName: "迎宾店",
          bizDate: "2026-03-29",
          metrics: { serviceRevenue: 1500, totalClockCount: 35, clockEffect: 42.86 },
        }),
        "1005:2026-03-30": buildReport({
          orgId: "1005",
          storeName: "迎宾店",
          bizDate: "2026-03-30",
          metrics: { serviceRevenue: 1600, totalClockCount: 36, clockEffect: 44.44 },
        }),
      },
    });

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "迎宾店近一周的营收情况",
      now,
    });

    expect(result.text).toContain("迎宾店 近7天 服务营收趋势");
    expect(result.text).toContain("2026-03-24");
    expect(result.text).toContain("2026-03-30");
    expect(result.text).not.toContain("服务营收: 9100.00 元");
  });

  it("prefers the serving query plane for single-store metric asks when runtime exposes it", async () => {
    const runtime = {
      buildReport: vi.fn(),
      getCurrentServingVersion: vi.fn().mockResolvedValue("serving-v1"),
      executeCompiledServingQuery: vi.fn().mockResolvedValue([
        {
          org_id: "1001",
          store_name: "义乌店",
          biz_date: "2026-03-30",
          service_revenue: 3200,
          average_ticket: 200,
          clock_effect: 80,
          point_clock_rate: 0.5,
        },
      ]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yiwu",
        employeeName: "义乌店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1001"],
      },
      text: "义乌店昨天营收多少",
      now,
    });

    expect(result.text).toContain("义乌店 2026-03-30");
    expect(result.text).toContain("服务营收: 3200.00 元");
    expect(runtime.executeCompiledServingQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheKey: expect.stringContaining("serving-v1:"),
      }),
    );
    expect(runtime.buildReport).not.toHaveBeenCalled();
  });

  it.each([
    ["义乌店昨天点钟", "点钟数量: 38 个", "点钟率: 50.0%"],
    ["义乌店昨天点钟数量", "点钟数量: 38 个", "点钟率: 50.0%"],
    ["义乌店昨天加钟", "加钟数量: 19 个", "加钟率: 25.0%"],
    ["义乌店昨天加钟数量", "加钟数量: 19 个", "加钟率: 25.0%"],
    ["义乌店昨天总种数", "总钟数: 96 钟", ""],
  ])("prefers the serving query plane for single-store clock metric asks when runtime exposes it: %s", async (text, expectedCount, expectedRate) => {
    const runtime = {
      buildReport: vi.fn(),
      getCurrentServingVersion: vi.fn().mockResolvedValue("serving-v1"),
      executeCompiledServingQuery: vi.fn().mockResolvedValue([
        {
          org_id: "1001",
          store_name: "义乌店",
          biz_date: "2026-03-30",
          service_revenue: 3200,
          total_clocks: 96,
          average_ticket: 200,
          clock_effect: 80,
          point_clock_rate: 0.5,
          add_clock_rate: 0.25,
        },
      ]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yiwu",
        employeeName: "义乌店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1001"],
      },
      text,
      now,
    });

    expect(result.text).toContain("义乌店 2026-03-30");
    expect(result.text).toContain(expectedCount);
    if (expectedRate) {
      expect(result.text).toContain(expectedRate);
    }
    expect(runtime.executeCompiledServingQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheKey: expect.stringContaining("serving-v1:"),
      }),
    );
    expect(runtime.buildReport).not.toHaveBeenCalled();
  });

  it("prefers the serving query plane for single-store customer-count asks when runtime exposes it", async () => {
    const runtime = {
      buildReport: vi.fn(),
      getCurrentServingVersion: vi.fn().mockResolvedValue("serving-v1"),
      executeCompiledServingQuery: vi.fn().mockResolvedValue([
        {
          org_id: "1001",
          store_name: "义乌店",
          biz_date: "2026-03-30",
          customer_count: 59,
        },
      ]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yiwu",
        employeeName: "义乌店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1001"],
      },
      text: "义乌店昨天客流量多少",
      now,
    });

    expect(result.text).toContain("义乌店 2026-03-30");
    expect(result.text).toContain("消费人数: 59 人");
    expect(runtime.executeCompiledServingQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheKey: expect.stringContaining("serving-v1:"),
      }),
    );
    expect(runtime.buildReport).not.toHaveBeenCalled();
  });

  it("prefers the serving query plane for single-store window customer-count asks when runtime exposes it", async () => {
    const runtime = {
      buildReport: vi.fn(),
      getCurrentServingVersion: vi.fn().mockResolvedValue("serving-v1"),
      executeCompiledServingQuery: vi.fn().mockResolvedValue([
        {
          org_id: "1001",
          store_name: "义乌店",
          window_end_biz_date: "2026-03-30",
          window_days: 7,
          customer_count: 289,
        },
      ]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yiwu",
        employeeName: "义乌店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1001"],
      },
      text: "义乌店近7天客流量多少",
      now,
    });

    expect(result.text).toContain("义乌店 近7天");
    expect(result.text).toContain("消费人数: 289 人");
    expect(runtime.executeCompiledServingQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheKey: expect.stringContaining("serving-v1:"),
      }),
    );
    expect(runtime.buildReport).not.toHaveBeenCalled();
  });

  it("auto-expands short Chinese numeral windows like 近三天 into day-by-day customer detail", async () => {
    const runtime = {
      ...buildRuntime({
        reports: {
          "1001:2026-03-28": buildReport({
            orgId: "1001",
            storeName: "义乌店",
            bizDate: "2026-03-28",
            metrics: { customerCount: 63 },
          }),
          "1001:2026-03-29": buildReport({
            orgId: "1001",
            storeName: "义乌店",
            bizDate: "2026-03-29",
            metrics: { customerCount: 70 },
          }),
          "1001:2026-03-30": buildReport({
            orgId: "1001",
            storeName: "义乌店",
            bizDate: "2026-03-30",
            metrics: { customerCount: 51 },
          }),
        },
      }),
      getCurrentServingVersion: vi.fn().mockResolvedValue("serving-v1"),
      executeCompiledServingQuery: vi.fn().mockResolvedValue([
        {
          org_id: "1001",
          store_name: "义乌店",
          window_end_biz_date: "2026-03-30",
          window_days: 3,
          customer_count: 184,
        },
      ]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yiwu",
        employeeName: "义乌店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1001"],
      },
      text: "义乌店近三天客流量",
      now,
    });

    expect(result.text).toContain("义乌店 近三天 指标查询");
    expect(result.text).toContain("分天明细");
    expect(result.text).toContain("2026-03-28：消费人数: 63 人");
    expect(result.text).toContain("2026-03-29：消费人数: 70 人");
    expect(result.text).toContain("2026-03-30：消费人数: 51 人");
    expect(result.text).toContain("消费人数: 184 人");
    expect(runtime.executeCompiledServingQuery).not.toHaveBeenCalled();
  });

  it("auto-expands short-window core store metrics like revenue, order count, average ticket, and stored value", async () => {
    const runtime = {
      ...buildRuntime({
        reports: {
          "1001:2026-03-28": buildReport({
            orgId: "1001",
            storeName: "义乌店",
            bizDate: "2026-03-28",
            metrics: {
              serviceRevenue: 3200,
              serviceOrderCount: 16,
              customerCount: 16,
              averageTicket: 200,
              rechargeStoredValue: 1200,
            },
          }),
          "1001:2026-03-29": buildReport({
            orgId: "1001",
            storeName: "义乌店",
            bizDate: "2026-03-29",
            metrics: {
              serviceRevenue: 3400,
              serviceOrderCount: 17,
              customerCount: 16,
              averageTicket: 212.5,
              rechargeStoredValue: 1500,
            },
          }),
          "1001:2026-03-30": buildReport({
            orgId: "1001",
            storeName: "义乌店",
            bizDate: "2026-03-30",
            metrics: {
              serviceRevenue: 3600,
              serviceOrderCount: 18,
              customerCount: 16,
              averageTicket: 225,
              rechargeStoredValue: 900,
            },
          }),
        },
      }),
      getCurrentServingVersion: vi.fn().mockResolvedValue("serving-v1"),
      executeCompiledServingQuery: vi.fn().mockResolvedValue([
        {
          org_id: "1001",
          store_name: "义乌店",
          window_end_biz_date: "2026-03-30",
          window_days: 3,
          service_revenue: 10200,
          service_order_count: 51,
          average_ticket: 212.5,
          recharge_stored_value: 3600,
        },
      ]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yiwu",
        employeeName: "义乌店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1001"],
      },
      text: "义乌店近三天营收、单数、客单价、储值",
      now,
    });

    expect(result.text).toContain("义乌店 近三天 指标查询");
    expect(result.text).toContain("分天明细");
    expect(result.text).toContain(
      "2026-03-28：服务营收: 3200.00 元；服务单数: 16 单；客单价: 200.00 元；充值总额（含赠送）: 1200.00 元",
    );
    expect(result.text).toContain(
      "2026-03-29：服务营收: 3400.00 元；服务单数: 17 单；客单价: 212.50 元；充值总额（含赠送）: 1500.00 元",
    );
    expect(result.text).toContain(
      "2026-03-30：服务营收: 3600.00 元；服务单数: 18 单；客单价: 225.00 元；充值总额（含赠送）: 900.00 元",
    );
    expect(result.text).toContain("服务营收: 10200.00 元");
    expect(result.text).toContain("服务单数: 51 单");
    expect(result.text).toContain("客单价: 212.50 元");
    expect(result.text).toContain("充值总额（含赠送）: 3600.00 元");
    expect(runtime.executeCompiledServingQuery).not.toHaveBeenCalled();
  });

  it("auto-expands short-window bare stored-value asks into daily recharge stored value detail", async () => {
    const runtime = {
      ...buildRuntime({
        reports: {
          "1001:2026-03-28": buildReport({
            orgId: "1001",
            storeName: "义乌店",
            bizDate: "2026-03-28",
            metrics: {
              rechargeStoredValue: 1200,
            },
          }),
          "1001:2026-03-29": buildReport({
            orgId: "1001",
            storeName: "义乌店",
            bizDate: "2026-03-29",
            metrics: {
              rechargeStoredValue: 1500,
            },
          }),
          "1001:2026-03-30": buildReport({
            orgId: "1001",
            storeName: "义乌店",
            bizDate: "2026-03-30",
            metrics: {
              rechargeStoredValue: 900,
            },
          }),
        },
      }),
      getCurrentServingVersion: vi.fn().mockResolvedValue("serving-v1"),
      executeCompiledServingQuery: vi.fn().mockResolvedValue([
        {
          org_id: "1001",
          store_name: "义乌店",
          window_end_biz_date: "2026-03-30",
          window_days: 3,
          recharge_stored_value: 3600,
        },
      ]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yiwu",
        employeeName: "义乌店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1001"],
      },
      text: "义乌店近三天储值",
      now,
    });

    expect(result.text).toContain("义乌店 近三天 指标查询");
    expect(result.text).toContain("分天明细");
    expect(result.text).toContain("2026-03-28：充值总额（含赠送）: 1200.00 元");
    expect(result.text).toContain("2026-03-29：充值总额（含赠送）: 1500.00 元");
    expect(result.text).toContain("2026-03-30：充值总额（含赠送）: 900.00 元");
    expect(result.text).toContain("充值总额（含赠送）: 3600.00 元");
    expect(runtime.executeCompiledServingQuery).not.toHaveBeenCalled();
  });

  it("auto-expands short-window daily-safe operating metrics like payment mix, groupbuy, commissions, new members, occupancy, and margin", async () => {
    const runtime = {
      ...buildRuntime({
        reports: {
          "1001:2026-03-28": buildReport({
            orgId: "1001",
            storeName: "义乌店",
            bizDate: "2026-03-28",
            metrics: {
              memberPaymentAmount: 1800,
              wechatPaymentShare: 0.1,
              groupbuyAmount: 600,
              techCommission: 900,
              marketRevenue: 420,
              newMembers: 4,
              roomOccupancyRate: 0.68,
              grossMarginRate: 0.52,
            },
          }),
          "1001:2026-03-29": buildReport({
            orgId: "1001",
            storeName: "义乌店",
            bizDate: "2026-03-29",
            metrics: {
              memberPaymentAmount: 2100,
              wechatPaymentShare: 0.12,
              groupbuyAmount: 720,
              techCommission: 980,
              marketRevenue: 510,
              newMembers: 6,
              roomOccupancyRate: 0.73,
              grossMarginRate: 0.55,
            },
          }),
          "1001:2026-03-30": buildReport({
            orgId: "1001",
            storeName: "义乌店",
            bizDate: "2026-03-30",
            metrics: {
              memberPaymentAmount: 2400,
              wechatPaymentShare: 0.15,
              groupbuyAmount: 810,
              techCommission: 1050,
              marketRevenue: 560,
              newMembers: 5,
              roomOccupancyRate: 0.79,
              grossMarginRate: 0.57,
            },
          }),
        },
      }),
      getCurrentServingVersion: vi.fn().mockResolvedValue("serving-v1"),
      executeCompiledServingQuery: vi.fn().mockResolvedValue([
        {
          org_id: "1001",
          store_name: "义乌店",
          window_end_biz_date: "2026-03-30",
          window_days: 3,
          member_payment_amount: 6300,
          wechat_payment_share: 0.1238,
          groupbuy_amount: 2130,
          tech_commission: 2930,
          market_revenue: 1490,
          new_members: 15,
          room_occupancy_rate: 0.7333,
          gross_margin_rate: 0.5467,
        },
      ]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yiwu",
        employeeName: "义乌店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1001"],
      },
      text: "义乌店近三天会员支付金额、微信支付占比、团购金额、技师提成、推销营收、新增会员、包间上座率、毛利率",
      now,
    });

    expect(result.text).toContain("义乌店 近三天 指标查询");
    expect(result.text).toContain("分天明细");
    expect(result.text).toContain("2026-03-28：会员支付金额: 1800.00 元；微信支付占比: 10.0%；团购金额: 600.00 元；技师提成金额: 900.00 元；推销营收: 420.00 元");
    expect(result.text).toContain("新增会员: 4 人；包间上座率: 68.0%；毛利率: 52.0%");
    expect(result.text).toContain("2026-03-29：会员支付金额: 2100.00 元；微信支付占比: 12.0%；团购金额: 720.00 元；技师提成金额: 980.00 元；推销营收: 510.00 元");
    expect(result.text).toContain("新增会员: 6 人；包间上座率: 73.0%；毛利率: 55.0%");
    expect(result.text).toContain("2026-03-30：会员支付金额: 2400.00 元；微信支付占比: 15.0%；团购金额: 810.00 元；技师提成金额: 1050.00 元；推销营收: 560.00 元");
    expect(result.text).toContain("新增会员: 5 人；包间上座率: 79.0%；毛利率: 57.0%");
    expect(runtime.executeCompiledServingQuery).not.toHaveBeenCalled();
  });

  it("keeps explicit day-by-day customer-count asks on the runtime-render path so daily detail is preserved", async () => {
    const runtime = {
      ...buildRuntime({
        reports: {
          "1001:2026-03-26": buildReport({
            orgId: "1001",
            storeName: "义乌店",
            bizDate: "2026-03-26",
            metrics: { customerCount: 60 },
          }),
          "1001:2026-03-27": buildReport({
            orgId: "1001",
            storeName: "义乌店",
            bizDate: "2026-03-27",
            metrics: { customerCount: 62 },
          }),
          "1001:2026-03-28": buildReport({
            orgId: "1001",
            storeName: "义乌店",
            bizDate: "2026-03-28",
            metrics: { customerCount: 66 },
          }),
          "1001:2026-03-29": buildReport({
            orgId: "1001",
            storeName: "义乌店",
            bizDate: "2026-03-29",
            metrics: { customerCount: 69 },
          }),
          "1001:2026-03-30": buildReport({
            orgId: "1001",
            storeName: "义乌店",
            bizDate: "2026-03-30",
            metrics: { customerCount: 51 },
          }),
        },
      }),
      getCurrentServingVersion: vi.fn().mockResolvedValue("serving-v1"),
      executeCompiledServingQuery: vi.fn().mockResolvedValue([
        {
          org_id: "1001",
          store_name: "义乌店",
          window_end_biz_date: "2026-03-30",
          window_days: 5,
          customer_count: 308,
        },
      ]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yiwu",
        employeeName: "义乌店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1001"],
      },
      text: "义乌店近5天每天的客流量",
      now,
    });

    expect(result.text).toContain("义乌店 近5天 指标查询");
    expect(result.text).toContain("分天明细");
    expect(result.text).toContain("2026-03-26：消费人数: 60 人");
    expect(result.text).toContain("2026-03-27：消费人数: 62 人");
    expect(result.text).toContain("2026-03-28：消费人数: 66 人");
    expect(result.text).toContain("2026-03-29：消费人数: 69 人");
    expect(result.text).toContain("2026-03-30：消费人数: 51 人");
    expect(result.text).toContain("消费人数: 308 人");
    expect(runtime.executeCompiledServingQuery).not.toHaveBeenCalled();
  });

  it("prefers the serving query plane for single-store order-count asks when runtime exposes it", async () => {
    const runtime = {
      buildReport: vi.fn(),
      getCurrentServingVersion: vi.fn().mockResolvedValue("serving-v1"),
      executeCompiledServingQuery: vi.fn().mockResolvedValue([
        {
          org_id: "1001",
          store_name: "义乌店",
          biz_date: "2026-03-30",
          service_order_count: 48,
        },
      ]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yiwu",
        employeeName: "义乌店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1001"],
      },
      text: "义乌店昨天订单数多少",
      now,
    });

    expect(result.text).toContain("义乌店 2026-03-30");
    expect(result.text).toContain("服务单数: 48 单");
    expect(runtime.executeCompiledServingQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheKey: expect.stringContaining("serving-v1:"),
      }),
    );
    expect(runtime.buildReport).not.toHaveBeenCalled();
  });

  it("prefers the serving query plane for single-store order-average asks when runtime exposes it", async () => {
    const runtime = {
      getCurrentServingVersion: vi.fn().mockResolvedValue("serving-v1"),
      executeCompiledServingQuery: vi.fn().mockResolvedValue([
        {
          org_id: "1001",
          store_name: "义乌店",
          biz_date: "2026-03-30",
          service_revenue: 3200,
          service_order_count: 16,
          customer_count: 18,
          total_clocks: 40,
          average_ticket: 177.78,
          order_average_amount: 200,
          clock_effect: 80,
          point_clock_rate: 0.5,
          add_clock_rate: 0.25,
        },
      ]),
      buildReport: vi.fn(),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "义乌店昨天单均金额",
      now,
    });

    expect(result.text).toContain("义乌店 2026-03-30");
    expect(result.text).toContain("单均金额: 200.00 元");
    expect(runtime.executeCompiledServingQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheKey: expect.stringContaining("serving-v1:"),
      }),
    );
    expect(runtime.buildReport).not.toHaveBeenCalled();
  });

  it("prefers the serving query plane for single-store total-clock asks when runtime exposes it", async () => {
    const runtime = {
      buildReport: vi.fn(),
      getCurrentServingVersion: vi.fn().mockResolvedValue("serving-v1"),
      executeCompiledServingQuery: vi.fn().mockResolvedValue([
        {
          org_id: "1001",
          store_name: "义乌店",
          biz_date: "2026-03-30",
          total_clocks: 150,
        },
      ]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yiwu",
        employeeName: "义乌店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1001"],
      },
      text: "义乌店昨天总钟数",
      now,
    });

    expect(result.text).toContain("义乌店 2026-03-30");
    expect(result.text).toContain("总钟数: 150 钟");
    expect(runtime.executeCompiledServingQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheKey: expect.stringContaining("serving-v1:"),
      }),
    );
    expect(runtime.buildReport).not.toHaveBeenCalled();
  });

  it("keeps multi-day clock metric asks on the runtime-render path so daily breakdown survives even when serving is available", async () => {
    const runtime = {
      buildReport: vi.fn(async () => {
        throw new Error("should use daily kpi window fast path");
      }),
      getCurrentServingVersion: vi.fn().mockResolvedValue("serving-v1"),
      executeCompiledServingQuery: vi.fn().mockResolvedValue([
        {
          org_id: "1004",
          store_name: "锦苑店",
          window_end_biz_date: "2026-03-30",
          window_days: 3,
          total_clocks: 268,
          point_clock_rate: 0.36,
          add_clock_rate: 0.122,
        },
      ]),
      listStoreManagerDailyKpiByDateRange: vi.fn(async () => [
        {
          bizDate: "2026-03-28",
          orgId: "1004",
          storeName: "锦苑店",
          dailyActualRevenue: 9800,
          dailyCardConsume: 1800,
          dailyOrderCount: 38,
          totalClocks: 80,
          assignClocks: 14,
          queueClocks: 61,
          pointClockRate: 14 / 75,
          averageTicket: 257.9,
          clockEffect: 122.5,
        },
        {
          bizDate: "2026-03-29",
          orgId: "1004",
          storeName: "锦苑店",
          dailyActualRevenue: 10800,
          dailyCardConsume: 2000,
          dailyOrderCount: 41,
          totalClocks: 92,
          assignClocks: 18,
          queueClocks: 72,
          pointClockRate: 18 / 90,
          averageTicket: 263.4,
          clockEffect: 117.4,
        },
        {
          bizDate: "2026-03-30",
          orgId: "1004",
          storeName: "锦苑店",
          dailyActualRevenue: 11200,
          dailyCardConsume: 2100,
          dailyOrderCount: 43,
          totalClocks: 96,
          assignClocks: 20,
          queueClocks: 77,
          pointClockRate: 20 / 97,
          averageTicket: 260.5,
          clockEffect: 116.7,
        },
      ]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "锦苑店近3天的加钟数和加钟率",
      now,
    });

    expect(result.text).toContain("锦苑店 近3天 指标查询");
    expect(result.text).toContain("分天明细");
    expect(result.text).toContain("2026-03-28：加钟数量 5 个，加钟率 6.7%（5/75）");
    expect(result.text).toContain("2026-03-29：加钟数量 2 个，加钟率 2.2%（2/90）");
    expect(result.text).toContain("2026-03-30：加钟数量 0 个，加钟率 0.0%（0/97）");
    expect(runtime.executeCompiledServingQuery).not.toHaveBeenCalled();
    expect(runtime.buildReport).not.toHaveBeenCalled();
  });

  it("renders both point and add clock daily breakdown for colloquial combined 点加钟 asks", async () => {
    const runtime = {
      buildReport: vi.fn(async () => {
        throw new Error("should use daily kpi window fast path");
      }),
      getCurrentServingVersion: vi.fn().mockResolvedValue("serving-v1"),
      executeCompiledServingQuery: vi.fn().mockResolvedValue([
        {
          org_id: "1004",
          store_name: "锦苑店",
          window_end_biz_date: "2026-03-30",
          window_days: 3,
          total_clocks: 268,
          point_clock_rate: 0.36,
          add_clock_rate: 0.122,
        },
      ]),
      listStoreManagerDailyKpiByDateRange: vi.fn(async () => [
        {
          bizDate: "2026-03-28",
          orgId: "1004",
          storeName: "锦苑店",
          dailyActualRevenue: 9800,
          dailyCardConsume: 1800,
          dailyOrderCount: 38,
          totalClocks: 80,
          assignClocks: 14,
          queueClocks: 61,
          pointClockRate: 14 / 75,
          averageTicket: 257.9,
          clockEffect: 122.5,
        },
        {
          bizDate: "2026-03-29",
          orgId: "1004",
          storeName: "锦苑店",
          dailyActualRevenue: 10800,
          dailyCardConsume: 2000,
          dailyOrderCount: 41,
          totalClocks: 92,
          assignClocks: 18,
          queueClocks: 72,
          pointClockRate: 18 / 90,
          averageTicket: 263.4,
          clockEffect: 117.4,
        },
        {
          bizDate: "2026-03-30",
          orgId: "1004",
          storeName: "锦苑店",
          dailyActualRevenue: 11200,
          dailyCardConsume: 2100,
          dailyOrderCount: 43,
          totalClocks: 96,
          assignClocks: 20,
          queueClocks: 77,
          pointClockRate: 20 / 97,
          averageTicket: 260.5,
          clockEffect: 116.7,
        },
      ]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "锦苑店近3天的点加钟情况",
      now,
    });

    expect(result.text).toContain("锦苑店 近3天 指标查询");
    expect(result.text).toContain("分天明细");
    expect(result.text).toContain(
      "2026-03-28：点钟数量 14 个，点钟率 18.7%（14/75）；加钟数量 5 个，加钟率 6.7%（5/75）",
    );
    expect(result.text).toContain(
      "2026-03-29：点钟数量 18 个，点钟率 20.0%（18/90）；加钟数量 2 个，加钟率 2.2%（2/90）",
    );
    expect(result.text).toContain(
      "2026-03-30：点钟数量 20 个，点钟率 20.6%（20/97）；加钟数量 0 个，加钟率 0.0%（0/97）",
    );
    expect(result.text).toContain("点钟数量: 52 个");
    expect(result.text).toContain("点钟率: 19.8%（52/262）");
    expect(result.text).toContain("加钟数量: 7 个");
    expect(result.text).toContain("加钟率: 2.7%（7/262）");
    expect(runtime.executeCompiledServingQuery).not.toHaveBeenCalled();
    expect(runtime.buildReport).not.toHaveBeenCalled();
  });

  it("prefers the serving query plane for total-clock breakdown asks when runtime exposes it", async () => {
    const runtime = {
      buildReport: vi.fn(),
      getCurrentServingVersion: vi.fn().mockResolvedValue("serving-v1"),
      executeCompiledServingQuery: vi.fn().mockResolvedValue([
        {
          org_id: "1001",
          store_name: "义乌店",
          biz_date: "2026-03-30",
          total_clocks: 136,
          assign_clocks: 31,
          queue_clocks: 98,
          add_clock_count: 7,
          up_clock_record_count: 129,
          point_clock_record_count: 31,
          point_clock_rate: 31 / 129,
          add_clock_rate: 7 / 129,
        },
      ]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "义乌店昨日136个钟，是怎么构成的？",
      now,
    });

    expect(result.text).toContain("义乌店 2026-03-30 钟数构成");
    expect(result.text).toContain("总钟数: 136.0 个");
    expect(result.text).toContain("点钟: 31.0 个");
    expect(result.text).toContain("排钟: 98.0 个");
    expect(result.text).toContain("加钟: 7.0 个");
    expect(runtime.executeCompiledServingQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheKey: expect.stringContaining("serving-v1:"),
      }),
    );
    expect(runtime.buildReport).not.toHaveBeenCalled();
  });

  it("prefers the serving query plane for hq portfolio asks when runtime exposes it", async () => {
    const runtime = {
      buildReport: vi.fn(),
      getCurrentServingVersion: vi.fn().mockResolvedValue("serving-v1"),
      executeCompiledServingQuery: vi.fn().mockResolvedValue([
        {
          org_id: "1003",
          store_name: "华美店",
          window_end_biz_date: "2026-03-30",
          window_days: 7,
          service_revenue: 8600,
          average_ticket: 118,
          sleeping_member_rate: 0.32,
          renewal_pressure_index_30d: 1.4,
          member_repurchase_rate_7d: 0.42,
          risk_score: 72,
        },
        {
          org_id: "1001",
          store_name: "义乌店",
          window_end_biz_date: "2026-03-30",
          window_days: 7,
          service_revenue: 9800,
          average_ticket: 132,
          sleeping_member_rate: 0.15,
          renewal_pressure_index_30d: 1.1,
          member_repurchase_rate_7d: 0.73,
          risk_score: 48,
        },
      ]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "五店近7天哪家店最危险",
      now,
    });

    expect(result.text).toContain("2店 近7天 风险排序");
    expect(result.text).toContain("1. 华美店 | 风险分 72.0");
    expect(result.text).toContain("原因：沉默会员率 32.0%、会员7日复购率 42.0%");
    expect(result.text).toContain("总部先盯：把 华美店 沉默会员召回列成今日动作单，别让老会员盘继续变冷。");
    expect(result.text).toContain("2. 义乌店 | 风险分 48.0");
    expect(result.text).toContain("原因：沉默会员率 15.0%、会员7日复购率 73.0%");
    expect(runtime.buildReport).not.toHaveBeenCalled();
  });

  it("renders a dedicated HQ risk radar for explicit portfolio risk asks", async () => {
    const currentDates = [
      "2026-03-24",
      "2026-03-25",
      "2026-03-26",
      "2026-03-27",
      "2026-03-28",
      "2026-03-29",
      "2026-03-30",
    ];
    const previousDates = [
      "2026-03-17",
      "2026-03-18",
      "2026-03-19",
      "2026-03-20",
      "2026-03-21",
      "2026-03-22",
      "2026-03-23",
    ];
    const storeProfiles = [
      {
        orgId: "1003",
        storeName: "华美店",
        current: {
          serviceRevenue: 8600,
          averageTicket: 118,
          sleepingMemberRate: 0.32,
          renewalPressureIndex30d: 1.4,
          memberRepurchaseRate7d: 0.42,
          groupbuy7dRevisitRate: 0.31,
          groupbuy7dStoredValueConversionRate: 0.14,
          addClockRate: 0.21,
        },
        previous: {
          serviceRevenue: 9400,
          averageTicket: 126,
          sleepingMemberRate: 0.22,
          renewalPressureIndex30d: 1.18,
          memberRepurchaseRate7d: 0.56,
          groupbuy7dRevisitRate: 0.4,
          groupbuy7dStoredValueConversionRate: 0.22,
          addClockRate: 0.28,
        },
      },
      {
        orgId: "1001",
        storeName: "义乌店",
        current: {
          serviceRevenue: 9800,
          averageTicket: 132,
          sleepingMemberRate: 0.15,
          renewalPressureIndex30d: 1.1,
          memberRepurchaseRate7d: 0.73,
          groupbuy7dRevisitRate: 0.58,
          groupbuy7dStoredValueConversionRate: 0.22,
          addClockRate: 0.3,
        },
        previous: {
          serviceRevenue: 10100,
          averageTicket: 136,
          sleepingMemberRate: 0.1,
          renewalPressureIndex30d: 1.0,
          memberRepurchaseRate7d: 0.78,
          groupbuy7dRevisitRate: 0.61,
          groupbuy7dStoredValueConversionRate: 0.25,
          addClockRate: 0.34,
        },
      },
      {
        orgId: "1002",
        storeName: "园中园店",
        current: {
          serviceRevenue: 9200,
          averageTicket: 128,
          sleepingMemberRate: 0.11,
          renewalPressureIndex30d: 1.04,
          memberRepurchaseRate7d: 0.61,
          groupbuy7dRevisitRate: 0.49,
          groupbuy7dStoredValueConversionRate: 0.2,
          addClockRate: 0.29,
        },
        previous: {
          serviceRevenue: 9300,
          averageTicket: 129,
          sleepingMemberRate: 0.1,
          renewalPressureIndex30d: 1.01,
          memberRepurchaseRate7d: 0.64,
          groupbuy7dRevisitRate: 0.52,
          groupbuy7dStoredValueConversionRate: 0.21,
          addClockRate: 0.3,
        },
      },
      {
        orgId: "1004",
        storeName: "迎宾店",
        current: {
          serviceRevenue: 9100,
          averageTicket: 126,
          sleepingMemberRate: 0.12,
          renewalPressureIndex30d: 1.05,
          memberRepurchaseRate7d: 0.59,
          groupbuy7dRevisitRate: 0.47,
          groupbuy7dStoredValueConversionRate: 0.19,
          addClockRate: 0.28,
        },
        previous: {
          serviceRevenue: 9150,
          averageTicket: 127,
          sleepingMemberRate: 0.11,
          renewalPressureIndex30d: 1.03,
          memberRepurchaseRate7d: 0.61,
          groupbuy7dRevisitRate: 0.49,
          groupbuy7dStoredValueConversionRate: 0.2,
          addClockRate: 0.29,
        },
      },
      {
        orgId: "1005",
        storeName: "锦苑店",
        current: {
          serviceRevenue: 8900,
          averageTicket: 124,
          sleepingMemberRate: 0.09,
          renewalPressureIndex30d: 1.0,
          memberRepurchaseRate7d: 0.68,
          groupbuy7dRevisitRate: 0.5,
          groupbuy7dStoredValueConversionRate: 0.22,
          addClockRate: 0.31,
        },
        previous: {
          serviceRevenue: 9000,
          averageTicket: 125,
          sleepingMemberRate: 0.08,
          renewalPressureIndex30d: 0.98,
          memberRepurchaseRate7d: 0.69,
          groupbuy7dRevisitRate: 0.52,
          groupbuy7dStoredValueConversionRate: 0.23,
          addClockRate: 0.32,
        },
      },
    ];
    const reports = Object.fromEntries(
      storeProfiles.flatMap((profile) => [
        ...currentDates.map((bizDate) => [
          `${profile.orgId}:${bizDate}`,
          buildReport({
            orgId: profile.orgId,
            storeName: profile.storeName,
            bizDate,
            metrics: profile.current,
          }),
        ]),
        ...previousDates.map((bizDate) => [
          `${profile.orgId}:${bizDate}`,
          buildReport({
            orgId: profile.orgId,
            storeName: profile.storeName,
            bizDate,
            metrics: profile.previous,
          }),
        ]),
      ]),
    );
    const runtime = buildRuntime({ reports });

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "五店近7天风险在哪",
      now,
    });

    expect(result.text).toContain("风险雷达");
    expect(result.text).toContain("风险排序");
    expect(result.text).toContain("总部动作建议");
    expect(result.text).not.toContain("总部经营全景");
  });

  it("renders a boss-style HQ focus summary for open-ended five-store priority asks on the serving plane", async () => {
    const runtime = {
      buildReport: vi.fn(),
      getCurrentServingVersion: vi.fn().mockResolvedValue("serving-v1"),
      executeCompiledServingQuery: vi.fn().mockResolvedValue([
        {
          org_id: "1001",
          store_name: "义乌店",
          window_end_biz_date: "2026-03-30",
          window_days: 7,
          service_revenue: 9800,
          average_ticket: 132,
          sleeping_member_rate: 0.12,
          renewal_pressure_index_30d: 1.36,
          member_repurchase_rate_7d: 0.0,
          risk_score: 50.8,
        },
        {
          org_id: "1003",
          store_name: "华美店",
          window_end_biz_date: "2026-03-30",
          window_days: 7,
          service_revenue: 11200,
          average_ticket: 168,
          sleeping_member_rate: 0.18,
          renewal_pressure_index_30d: 1.27,
          member_repurchase_rate_7d: 0.0,
          risk_score: 48,
        },
      ]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "五店近7天重点看什么",
      now,
    });

    expect(result.text).toContain("2店 近7天 当前重点看什么");
    expect(result.text).toContain("一、增长结论");
    expect(result.text).toContain("二、总部先盯的增长信号");
    expect(result.text).toContain("1. 先看留存：");
    expect(result.text).toContain("4. 最后看拉新质量：当前快答未带出新客转化/团购承接链路");
    expect(result.text).toContain("三、总部优先动作");
    expect(result.text).toContain("四、门店风险排序");
    expect(result.text).toContain("义乌店");
    expect(result.text).not.toContain("CGO/CMO指标优先级");
    expect(runtime.buildReport).not.toHaveBeenCalled();
  });

  it("renders a more natural HQ focus summary without duplicated machine-like cohort phrasing", async () => {
    const runtime = {
      buildReport: vi.fn(),
      getCurrentServingVersion: vi.fn().mockResolvedValue("serving-v1"),
      executeCompiledServingQuery: vi.fn().mockResolvedValue([
        {
          org_id: "1001",
          store_name: "义乌店",
          window_end_biz_date: "2026-03-30",
          window_days: 7,
          service_revenue: 9800,
          average_ticket: 132,
          sleeping_member_rate: 0.12,
          renewal_pressure_index_30d: 1.36,
          member_repurchase_rate_7d: 0.0,
          risk_score: 50.8,
        },
        {
          org_id: "1003",
          store_name: "华美店",
          window_end_biz_date: "2026-03-30",
          window_days: 7,
          service_revenue: 11200,
          average_ticket: 168,
          sleeping_member_rate: 0.18,
          renewal_pressure_index_30d: 1.27,
          member_repurchase_rate_7d: 0.0,
          risk_score: 48,
        },
        {
          org_id: "1005",
          store_name: "迎宾店",
          window_end_biz_date: "2026-03-30",
          window_days: 7,
          service_revenue: 10500,
          average_ticket: 155,
          sleeping_member_rate: 0.1,
          renewal_pressure_index_30d: 1.22,
          member_repurchase_rate_7d: 0.01,
          risk_score: 46.3,
        },
        {
          org_id: "1004",
          store_name: "锦苑店",
          window_end_biz_date: "2026-03-30",
          window_days: 7,
          service_revenue: 10000,
          average_ticket: 148,
          sleeping_member_rate: 0.09,
          renewal_pressure_index_30d: 1.22,
          member_repurchase_rate_7d: 0.167,
          risk_score: 40,
        },
        {
          org_id: "1002",
          store_name: "园中园店",
          window_end_biz_date: "2026-03-30",
          window_days: 7,
          service_revenue: 9600,
          average_ticket: 142,
          sleeping_member_rate: 0.08,
          renewal_pressure_index_30d: 1.07,
          member_repurchase_rate_7d: 0.083,
          risk_score: 38.9,
        },
      ]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "五店近7天重点看什么",
      now,
    });

    expect(result.text).toContain("五店都存在会员7日复购偏弱问题");
    expect(result.text).toContain("除园中园店外，其余4店");
    expect(result.text).not.toContain("等5店");
    expect(result.text).not.toContain("等4店");
    expect(runtime.buildReport).not.toHaveBeenCalled();
  });

  it("renders a dedicated HQ focus summary for broad portfolio diagnosis asks", async () => {
    const currentDates = Array.from({ length: 30 }, (_, index) =>
      `2026-03-${String(index + 1).padStart(2, "0")}`,
    );
    const previousDates = Array.from({ length: 30 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 0, 30 + index));
      return date.toISOString().slice(0, 10);
    });
    const storeProfiles = [
      {
        orgId: "1001",
        storeName: "义乌店",
        current: {
          serviceRevenue: 9800,
          averageTicket: 132,
          sleepingMemberRate: 0.12,
          renewalPressureIndex30d: 1.36,
          memberRepurchaseRate7d: 0.0,
          addClockRate: 0.24,
          groupbuy7dRevisitRate: 0.36,
          groupbuy7dStoredValueConversionRate: 0.16,
        },
        previous: {
          serviceRevenue: 10300,
          averageTicket: 140,
          sleepingMemberRate: 0.1,
          renewalPressureIndex30d: 1.15,
          memberRepurchaseRate7d: 0.12,
          addClockRate: 0.29,
          groupbuy7dRevisitRate: 0.4,
          groupbuy7dStoredValueConversionRate: 0.22,
        },
      },
      {
        orgId: "1003",
        storeName: "华美店",
        current: {
          serviceRevenue: 11200,
          averageTicket: 168,
          sleepingMemberRate: 0.18,
          renewalPressureIndex30d: 1.27,
          memberRepurchaseRate7d: 0.0,
          addClockRate: 0.28,
          groupbuy7dRevisitRate: 0.31,
          groupbuy7dStoredValueConversionRate: 0.18,
        },
        previous: {
          serviceRevenue: 11400,
          averageTicket: 172,
          sleepingMemberRate: 0.14,
          renewalPressureIndex30d: 1.18,
          memberRepurchaseRate7d: 0.18,
          addClockRate: 0.31,
          groupbuy7dRevisitRate: 0.34,
          groupbuy7dStoredValueConversionRate: 0.2,
        },
      },
      {
        orgId: "1002",
        storeName: "园中园店",
        current: {
          serviceRevenue: 9600,
          averageTicket: 142,
          sleepingMemberRate: 0.08,
          renewalPressureIndex30d: 1.07,
          memberRepurchaseRate7d: 0.083,
          addClockRate: 0.26,
          groupbuy7dRevisitRate: 0.35,
          groupbuy7dStoredValueConversionRate: 0.17,
        },
        previous: {
          serviceRevenue: 9800,
          averageTicket: 145,
          sleepingMemberRate: 0.07,
          renewalPressureIndex30d: 1.0,
          memberRepurchaseRate7d: 0.15,
          addClockRate: 0.29,
          groupbuy7dRevisitRate: 0.39,
          groupbuy7dStoredValueConversionRate: 0.19,
        },
      },
      {
        orgId: "1004",
        storeName: "迎宾店",
        current: {
          serviceRevenue: 10500,
          averageTicket: 155,
          sleepingMemberRate: 0.1,
          renewalPressureIndex30d: 1.22,
          memberRepurchaseRate7d: 0.01,
          addClockRate: 0.27,
          groupbuy7dRevisitRate: 0.34,
          groupbuy7dStoredValueConversionRate: 0.16,
        },
        previous: {
          serviceRevenue: 10700,
          averageTicket: 158,
          sleepingMemberRate: 0.09,
          renewalPressureIndex30d: 1.14,
          memberRepurchaseRate7d: 0.11,
          addClockRate: 0.3,
          groupbuy7dRevisitRate: 0.38,
          groupbuy7dStoredValueConversionRate: 0.2,
        },
      },
      {
        orgId: "1005",
        storeName: "锦苑店",
        current: {
          serviceRevenue: 10000,
          averageTicket: 148,
          sleepingMemberRate: 0.09,
          renewalPressureIndex30d: 1.22,
          memberRepurchaseRate7d: 0.167,
          addClockRate: 0.29,
          groupbuy7dRevisitRate: 0.37,
          groupbuy7dStoredValueConversionRate: 0.18,
        },
        previous: {
          serviceRevenue: 10100,
          averageTicket: 149,
          sleepingMemberRate: 0.08,
          renewalPressureIndex30d: 1.12,
          memberRepurchaseRate7d: 0.19,
          addClockRate: 0.31,
          groupbuy7dRevisitRate: 0.39,
          groupbuy7dStoredValueConversionRate: 0.2,
        },
      },
    ];
    const reports = Object.fromEntries(
      storeProfiles.flatMap((profile) => [
        ...currentDates.map((bizDate) => [
          `${profile.orgId}:${bizDate}`,
          buildReport({
            orgId: profile.orgId,
            storeName: profile.storeName,
            bizDate,
            metrics: profile.current,
          }),
        ]),
        ...previousDates.map((bizDate) => [
          `${profile.orgId}:${bizDate}`,
          buildReport({
            orgId: profile.orgId,
            storeName: profile.storeName,
            bizDate,
            metrics: profile.previous,
          }),
        ]),
      ]),
    );
    const runtime = buildRuntime({ reports });

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "五店近30天整体哪里不对",
      now,
    });

    expect(result.text).toContain("当前重点看什么");
    expect(result.text).toContain("总部先盯的增长信号");
    expect(result.text).toContain("总部优先动作");
    expect(result.text).not.toContain("总部经营全景");
  });

  it("renders HQ rescue phrasing through the same focus capability output", async () => {
    const currentDates = Array.from({ length: 15 }, (_, index) =>
      `2026-03-${String(index + 16).padStart(2, "0")}`,
    );
    const previousDates = Array.from({ length: 15 }, (_, index) =>
      `2026-03-${String(index + 1).padStart(2, "0")}`,
    );
    const storeProfiles = [
      {
        orgId: "1001",
        storeName: "义乌店",
        current: {
          serviceRevenue: 9800,
          averageTicket: 132,
          sleepingMemberRate: 0.12,
          renewalPressureIndex30d: 1.36,
          memberRepurchaseRate7d: 0.0,
          addClockRate: 0.24,
          groupbuy7dRevisitRate: 0.36,
          groupbuy7dStoredValueConversionRate: 0.16,
        },
        previous: {
          serviceRevenue: 10300,
          averageTicket: 140,
          sleepingMemberRate: 0.1,
          renewalPressureIndex30d: 1.15,
          memberRepurchaseRate7d: 0.12,
          addClockRate: 0.29,
          groupbuy7dRevisitRate: 0.4,
          groupbuy7dStoredValueConversionRate: 0.22,
        },
      },
      {
        orgId: "1003",
        storeName: "华美店",
        current: {
          serviceRevenue: 11200,
          averageTicket: 168,
          sleepingMemberRate: 0.18,
          renewalPressureIndex30d: 1.27,
          memberRepurchaseRate7d: 0.0,
          addClockRate: 0.28,
          groupbuy7dRevisitRate: 0.31,
          groupbuy7dStoredValueConversionRate: 0.18,
        },
        previous: {
          serviceRevenue: 11400,
          averageTicket: 172,
          sleepingMemberRate: 0.14,
          renewalPressureIndex30d: 1.18,
          memberRepurchaseRate7d: 0.18,
          addClockRate: 0.31,
          groupbuy7dRevisitRate: 0.34,
          groupbuy7dStoredValueConversionRate: 0.2,
        },
      },
      {
        orgId: "1002",
        storeName: "园中园店",
        current: {
          serviceRevenue: 9600,
          averageTicket: 142,
          sleepingMemberRate: 0.08,
          renewalPressureIndex30d: 1.07,
          memberRepurchaseRate7d: 0.083,
          addClockRate: 0.26,
          groupbuy7dRevisitRate: 0.35,
          groupbuy7dStoredValueConversionRate: 0.17,
        },
        previous: {
          serviceRevenue: 9800,
          averageTicket: 145,
          sleepingMemberRate: 0.07,
          renewalPressureIndex30d: 1.0,
          memberRepurchaseRate7d: 0.15,
          addClockRate: 0.29,
          groupbuy7dRevisitRate: 0.39,
          groupbuy7dStoredValueConversionRate: 0.19,
        },
      },
      {
        orgId: "1004",
        storeName: "迎宾店",
        current: {
          serviceRevenue: 10500,
          averageTicket: 155,
          sleepingMemberRate: 0.1,
          renewalPressureIndex30d: 1.22,
          memberRepurchaseRate7d: 0.01,
          addClockRate: 0.27,
          groupbuy7dRevisitRate: 0.34,
          groupbuy7dStoredValueConversionRate: 0.16,
        },
        previous: {
          serviceRevenue: 10700,
          averageTicket: 158,
          sleepingMemberRate: 0.09,
          renewalPressureIndex30d: 1.14,
          memberRepurchaseRate7d: 0.11,
          addClockRate: 0.3,
          groupbuy7dRevisitRate: 0.38,
          groupbuy7dStoredValueConversionRate: 0.2,
        },
      },
      {
        orgId: "1005",
        storeName: "锦苑店",
        current: {
          serviceRevenue: 10000,
          averageTicket: 148,
          sleepingMemberRate: 0.09,
          renewalPressureIndex30d: 1.22,
          memberRepurchaseRate7d: 0.167,
          addClockRate: 0.29,
          groupbuy7dRevisitRate: 0.37,
          groupbuy7dStoredValueConversionRate: 0.18,
        },
        previous: {
          serviceRevenue: 10100,
          averageTicket: 149,
          sleepingMemberRate: 0.08,
          renewalPressureIndex30d: 1.12,
          memberRepurchaseRate7d: 0.19,
          addClockRate: 0.31,
          groupbuy7dRevisitRate: 0.39,
          groupbuy7dStoredValueConversionRate: 0.2,
        },
      },
    ];
    const reports = Object.fromEntries(
      storeProfiles.flatMap((profile) => [
        ...currentDates.map((bizDate) => [
          `${profile.orgId}:${bizDate}`,
          buildReport({
            orgId: profile.orgId,
            storeName: profile.storeName,
            bizDate,
            metrics: profile.current,
          }),
        ]),
        ...previousDates.map((bizDate) => [
          `${profile.orgId}:${bizDate}`,
          buildReport({
            orgId: profile.orgId,
            storeName: profile.storeName,
            bizDate,
            metrics: profile.previous,
          }),
        ]),
      ]),
    );
    const runtime = buildRuntime({ reports });

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "五店近15天总部先救哪家",
      now,
    });

    expect(result.text).toContain("当前重点看什么");
    expect(result.text).toContain("总部优先动作");
  });

  it("prefers the runtime HQ overview for open-ended priority asks even when serving exposes a ranking surface", async () => {
    const currentDates = [
      "2026-03-16",
      "2026-03-17",
      "2026-03-18",
      "2026-03-19",
      "2026-03-20",
      "2026-03-21",
      "2026-03-22",
      "2026-03-23",
      "2026-03-24",
      "2026-03-25",
      "2026-03-26",
      "2026-03-27",
      "2026-03-28",
      "2026-03-29",
      "2026-03-30",
    ];
    const previousDates = [
      "2026-03-01",
      "2026-03-02",
      "2026-03-03",
      "2026-03-04",
      "2026-03-05",
      "2026-03-06",
      "2026-03-07",
      "2026-03-08",
      "2026-03-09",
      "2026-03-10",
      "2026-03-11",
      "2026-03-12",
      "2026-03-13",
      "2026-03-14",
      "2026-03-15",
    ];
    const reports: Record<string, DailyStoreReport> = {};
    const stores = [
      {
        orgId: "1001",
        storeName: "义乌店",
        current: { serviceRevenue: 3300, totalClockCount: 42, averageTicket: 205, sleepingMemberRate: 0.14 },
        previous: { serviceRevenue: 3150, totalClockCount: 40, averageTicket: 198, sleepingMemberRate: 0.15 },
      },
      {
        orgId: "1002",
        storeName: "园中园店",
        current: { serviceRevenue: 3450, totalClockCount: 43, averageTicket: 208, sleepingMemberRate: 0.12 },
        previous: { serviceRevenue: 3200, totalClockCount: 39, averageTicket: 196, sleepingMemberRate: 0.14 },
      },
      {
        orgId: "1003",
        storeName: "华美店",
        current: { serviceRevenue: 2850, totalClockCount: 35, averageTicket: 188, sleepingMemberRate: 0.18 },
        previous: { serviceRevenue: 2920, totalClockCount: 36, averageTicket: 190, sleepingMemberRate: 0.17 },
      },
      {
        orgId: "1004",
        storeName: "锦苑店",
        current: {
          serviceRevenue: 2400,
          totalClockCount: 30,
          averageTicket: 172,
          sleepingMemberRate: 0.29,
          groupbuy7dRevisitRate: 1 / 6,
          addClockRate: 0.12,
          currentStoredBalance: 5200,
          storedBalanceLifeMonths: 1.6,
          renewalPressureIndex30d: 1.7,
          memberRepurchaseBaseCustomerCount7d: 10,
          memberRepurchaseReturnedCustomerCount7d: 3,
          memberRepurchaseRate7d: 0.3,
        },
        previous: {
          serviceRevenue: 2720,
          totalClockCount: 34,
          averageTicket: 182,
          sleepingMemberRate: 0.22,
          groupbuy7dRevisitRate: 2 / 6,
          addClockRate: 0.16,
          currentStoredBalance: 6100,
          storedBalanceLifeMonths: 2.2,
          renewalPressureIndex30d: 1.35,
          memberRepurchaseBaseCustomerCount7d: 10,
          memberRepurchaseReturnedCustomerCount7d: 4,
          memberRepurchaseRate7d: 0.4,
        },
      },
      {
        orgId: "1005",
        storeName: "迎宾店",
        current: { serviceRevenue: 3000, totalClockCount: 38, averageTicket: 194, sleepingMemberRate: 0.17 },
        previous: { serviceRevenue: 3010, totalClockCount: 37, averageTicket: 192, sleepingMemberRate: 0.17 },
      },
    ] as const;

    for (const store of stores) {
      for (const bizDate of currentDates) {
        reports[`${store.orgId}:${bizDate}`] = buildReport({
          orgId: store.orgId,
          storeName: store.storeName,
          bizDate,
          metrics: store.current,
        });
      }
      for (const bizDate of previousDates) {
        reports[`${store.orgId}:${bizDate}`] = buildReport({
          orgId: store.orgId,
          storeName: store.storeName,
          bizDate,
          metrics: store.previous,
        });
      }
    }

    const runtime = {
      ...buildRuntime({ reports }),
      getCurrentServingVersion: vi.fn().mockResolvedValue("serving-v1"),
      executeCompiledServingQuery: vi.fn().mockResolvedValue([
        {
          org_id: "1004",
          store_name: "锦苑店",
          window_end_biz_date: "2026-03-30",
          window_days: 15,
          service_revenue: 36000,
          average_ticket: 172,
          risk_score: 71,
        },
      ]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "哪个门店须重点关注",
      now,
    });

    expect(result.text).toContain("5店 近15天 总部经营全景");
    expect(result.text).toContain("最危险门店");
    expect(result.text).toContain("下周总部优先动作");
    expect(result.text).toContain("锦苑店");
    expect(runtime.executeCompiledServingQuery).not.toHaveBeenCalled();
  });

  it("prefers the serving query plane for single-store window compare asks when runtime exposes it", async () => {
    const runtime = {
      buildReport: vi.fn(),
      getCurrentServingVersion: vi.fn().mockResolvedValue("serving-v1"),
      executeCompiledServingQuery: vi.fn().mockResolvedValue([
        {
          org_id: "1001",
          store_name: "义乌店",
          window_end_biz_date: "2026-03-29",
          window_days: 7,
          service_revenue: 9800,
          baseline_window_end_biz_date: "2026-03-22",
          baseline_window_days: 7,
          baseline_service_revenue: 8600,
        },
      ]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yiwu",
        employeeName: "义乌店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1001"],
      },
      text: "义乌店近7天营收对比",
      now,
    });

    expect(result.text).toContain("义乌店 近7天 vs 前7天");
    expect(result.text).toContain("服务营收");
    expect(result.text).toContain("9800.00 元");
    expect(result.text).toContain("8600.00 元");
    expect(result.text).toContain("+1200.00 元");
    expect(runtime.executeCompiledServingQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryParams: ["1001", "2026-03-30", 7, "2026-03-23", 7],
        cacheKey: expect.stringContaining("serving-v1:"),
      }),
    );
    expect(runtime.buildReport).not.toHaveBeenCalled();
  });

  it("prefers the serving query plane for single-store point-clock compare asks when runtime exposes it", async () => {
    const runtime = {
      buildReport: vi.fn(),
      getCurrentServingVersion: vi.fn().mockResolvedValue("serving-v1"),
      executeCompiledServingQuery: vi.fn().mockResolvedValue([
        {
          org_id: "1001",
          store_name: "义乌店",
          window_end_biz_date: "2026-03-30",
          window_days: 7,
          service_revenue: 9800,
          average_ticket: 132,
          clock_effect: 81,
          point_clock_rate: 0.34,
          add_clock_rate: 0.19,
          risk_score: 48,
          baseline_window_end_biz_date: "2026-03-23",
          baseline_window_days: 7,
          baseline_service_revenue: 8600,
          baseline_average_ticket: 118,
          baseline_clock_effect: 77,
          baseline_point_clock_rate: 0.29,
          baseline_add_clock_rate: 0.16,
          baseline_risk_score: 52,
        },
      ]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "义乌店近7天点钟率对比",
      now,
    });

    expect(result.text).toContain("义乌店 近7天 vs 前7天");
    expect(result.text).toContain("点钟率");
    expect(result.text).toContain("34.0%");
    expect(result.text).toContain("29.0%");
    expect(result.text).toContain("+5.0pct");
    expect(runtime.buildReport).not.toHaveBeenCalled();
  });

  it("prefers the serving query plane for peer day compare asks when runtime exposes it", async () => {
    const runtime = {
      buildReport: vi.fn(),
      getCurrentServingVersion: vi.fn().mockResolvedValue("serving-v1"),
      executeCompiledServingQuery: vi.fn().mockResolvedValue([
        {
          org_id: "1001",
          store_name: "义乌店",
          biz_date: "2026-03-30",
          metric_value: 3200,
          baseline_org_id: "1002",
          baseline_store_name: "园中园店",
          baseline_biz_date: "2026-03-30",
          baseline_metric_value: 2800,
        },
      ]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "义乌店和园中园店昨天营收对比",
      now,
    });

    expect(result.text).toContain("义乌店 vs 园中园店");
    expect(result.text).toContain("服务营收");
    expect(result.text).toContain("3200.00 元");
    expect(result.text).toContain("2800.00 元");
    expect(result.text).toContain("+400.00 元");
    expect(runtime.buildReport).not.toHaveBeenCalled();
  });

  it("prefers the serving query plane for peer day customer-count compare asks when runtime exposes it", async () => {
    const runtime = {
      buildReport: vi.fn(),
      getCurrentServingVersion: vi.fn().mockResolvedValue("serving-v1"),
      executeCompiledServingQuery: vi.fn().mockResolvedValue([
        {
          org_id: "1001",
          store_name: "义乌店",
          biz_date: "2026-03-30",
          metric_value: 59,
          baseline_org_id: "1002",
          baseline_store_name: "园中园店",
          baseline_biz_date: "2026-03-30",
          baseline_metric_value: 46,
        },
      ]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "义乌店和园中园店昨天客流对比",
      now,
    });

    expect(result.text).toContain("义乌店 vs 园中园店");
    expect(result.text).toContain("消费人数");
    expect(result.text).toContain("59 人");
    expect(result.text).toContain("46 人");
    expect(result.text).toContain("差额 +13.0");
    expect(runtime.buildReport).not.toHaveBeenCalled();
  });

  it("prefers the serving query plane for customer profile asks when runtime exposes it", async () => {
    const runtime = {
      buildReport: vi.fn(),
      getCurrentServingVersion: vi.fn().mockResolvedValue("serving-v1"),
      executeCompiledServingQuery: vi.fn().mockResolvedValue([
        {
          org_id: "1001",
          as_of_biz_date: "2026-03-30",
          customer_display_name: "王女士",
          member_card_no: "YW-001",
          phone_suffix: "7500",
          primary_segment: "important-value-member",
          payment_segment: "stored-value-member",
          tech_loyalty_segment: "loyal-top-tech",
          pay_amount_90d: 3280,
          current_stored_amount: 1880,
          current_last_consume_time: "2026-03-29 18:00:00",
          current_silent_days: 1,
          top_tech_name: "白慧慧",
          followup_score: 86,
          risk_score: 18,
        },
      ]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yiwu",
        employeeName: "义乌店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1001"],
      },
      text: "义乌店尾号7500客户画像",
      now,
    });

    expect(result.text).toContain("义乌店 尾号 7500 顾客画像");
    expect(result.text).toContain("顾客: 王女士");
    expect(result.text).toContain("近90天消费: 3280.00 元");
    expect(runtime.buildReport).not.toHaveBeenCalled();
  });

  it("redacts identity-unstable tech auxiliaries in serving customer profile asks", async () => {
    const runtime = {
      buildReport: vi.fn(),
      getCurrentServingVersion: vi.fn().mockResolvedValue("serving-v1"),
      executeCompiledServingQuery: vi.fn().mockResolvedValue([
        {
          org_id: "1001",
          as_of_biz_date: "2026-03-30",
          customer_display_name: "王女士",
          member_card_no: "YW-001",
          phone_suffix: "7500",
          primary_segment: "important-value-member",
          payment_segment: "stored-value-member",
          tech_loyalty_segment: "loyal-top-tech",
          pay_amount_90d: 3280,
          current_stored_amount: 1880,
          current_last_consume_time: "2026-03-29 18:00:00",
          current_silent_days: 1,
          identity_stable: false,
          top_tech_name: "白慧慧",
          followup_score: 86,
          risk_score: 18,
        },
      ]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yiwu",
        employeeName: "义乌店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1001"],
      },
      text: "义乌店尾号7500客户画像",
      now,
    });

    expect(result.text).toContain("义乌店 尾号 7500 顾客画像");
    expect(result.text).toContain("身份未稳定");
    expect(result.text).not.toContain("白慧慧");
  });

  it("falls back to the legacy phone-suffix profile when the serving profile lookup returns no rows", async () => {
    const runtime = {
      ...buildRuntime({
        reports: {
          "1001:2026-03-30": buildReport({
            orgId: "1001",
            storeName: "义乌店",
            bizDate: "2026-03-30",
          }),
        },
        customerSegments: {
          "1001:2026-03-29": [
            buildCustomerSegment({
              bizDate: "2026-03-29",
              customerIdentityKey: "member:member-han",
              customerDisplayName: "韩先生",
              memberId: "member-han",
              memberCardNo: "yw7500",
              referenceCode: "yw7500",
              payAmount90d: 1680,
              payAmount30d: 780,
              visitCount90d: 6,
              visitCount30d: 3,
              topTechCode: "090",
              topTechName: "杜丽沙",
              topTechVisitCount90d: 4,
              topTechVisitShare90d: 4 / 6,
              primarySegment: "important-value-member",
            }),
          ],
        },
      }),
      getCurrentServingVersion: vi.fn().mockResolvedValue("serving-v1"),
      executeCompiledServingQuery: vi.fn().mockResolvedValue([]),
      findCurrentMembersByPhoneSuffix: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          memberId: "member-han",
          name: "韩先生",
          phone: "18503727500",
          storedAmount: 1280,
          consumeAmount: 4680,
          createdTime: "2026-01-01",
          lastConsumeTime: "2026-03-28",
          silentDays: 3,
          rawJson: "{}",
        },
      ]),
      listCurrentMemberCards: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          memberId: "member-han",
          cardId: "card-001",
          cardNo: "yw7500",
          rawJson: "{}",
        },
      ]),
      listConsumeBillsByDateRange: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          settleId: "S-201",
          settleNo: "XF2603280001",
          payAmount: 298,
          consumeAmount: 298,
          discountAmount: 0,
          antiFlag: false,
          optTime: "2026-03-28 20:15:00",
          bizDate: "2026-03-28",
          rawJson: JSON.stringify({
            SettleId: "S-201",
            SettleNo: "XF2603280001",
            Payments: [
              { Name: "会员", Amount: 238, PaymentType: 3 },
              { Name: "微信", Amount: 60, PaymentType: 4 },
            ],
            Infos: ["韩先生 (金悦卡) [yw7500],消费298.00元;"],
          }),
        },
      ]),
      listTechUpClockByDateRange: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          bizDate: "2026-03-28",
          personCode: "090",
          personName: "杜丽沙",
          count: 1,
          clockType: "点钟",
          turnover: 238,
          comm: 80,
          rawJson: "{}",
        },
      ]),
      listTechMarketByDateRange: vi.fn().mockResolvedValue([]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yiwu",
        employeeName: "义乌店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1001"],
      },
      text: "义乌店尾号7500客户画像",
      now,
    });

    expect(runtime.executeCompiledServingQuery).toHaveBeenCalledTimes(1);
    expect(result.text).toContain("一句话判断");
    expect(result.text).toContain("韩**");
    expect(result.text).not.toBe("未找到对应顾客画像。");
  });

  it("falls back to the legacy phone-suffix profile when the serving profile lookup relation is unavailable", async () => {
    const runtime = {
      ...buildRuntime({
        reports: {
          "1001:2026-03-30": buildReport({
            orgId: "1001",
            storeName: "义乌店",
            bizDate: "2026-03-30",
          }),
        },
        customerSegments: {
          "1001:2026-03-29": [
            buildCustomerSegment({
              bizDate: "2026-03-29",
              customerIdentityKey: "member:member-han",
              customerDisplayName: "韩先生",
              memberId: "member-han",
              memberCardNo: "yw7500",
              referenceCode: "yw7500",
              payAmount90d: 1680,
              payAmount30d: 780,
              visitCount90d: 6,
              visitCount30d: 3,
              topTechCode: "090",
              topTechName: "杜丽沙",
              topTechVisitCount90d: 4,
              topTechVisitShare90d: 4 / 6,
              primarySegment: "important-value-member",
            }),
          ],
        },
      }),
      getCurrentServingVersion: vi.fn().mockResolvedValue("serving-v1"),
      executeCompiledServingQuery: vi
        .fn()
        .mockRejectedValue(new Error('relation "serving_customer_profile_asof" does not exist')),
      findCurrentMembersByPhoneSuffix: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          memberId: "member-han",
          name: "韩先生",
          phone: "18503727500",
          storedAmount: 1280,
          consumeAmount: 4680,
          createdTime: "2026-01-01",
          lastConsumeTime: "2026-03-28",
          silentDays: 3,
          rawJson: "{}",
        },
      ]),
      listCurrentMemberCards: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          memberId: "member-han",
          cardId: "card-001",
          cardNo: "yw7500",
          rawJson: "{}",
        },
      ]),
      listConsumeBillsByDateRange: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          settleId: "S-201",
          settleNo: "XF2603280001",
          payAmount: 298,
          consumeAmount: 298,
          discountAmount: 0,
          antiFlag: false,
          optTime: "2026-03-28 20:15:00",
          bizDate: "2026-03-28",
          rawJson: JSON.stringify({
            SettleId: "S-201",
            SettleNo: "XF2603280001",
            Payments: [
              { Name: "会员", Amount: 238, PaymentType: 3 },
              { Name: "微信", Amount: 60, PaymentType: 4 },
            ],
            Infos: ["韩先生 (金悦卡) [yw7500],消费298.00元;"],
          }),
        },
      ]),
      listTechUpClockByDateRange: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          bizDate: "2026-03-28",
          personCode: "090",
          personName: "杜丽沙",
          count: 1,
          clockType: "点钟",
          turnover: 238,
          comm: 80,
          rawJson: "{}",
        },
      ]),
      listTechMarketByDateRange: vi.fn().mockResolvedValue([]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yiwu",
        employeeName: "义乌店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1001"],
      },
      text: "义乌店尾号7500客户画像",
      now,
    });

    expect(runtime.executeCompiledServingQuery).toHaveBeenCalledTimes(1);
    expect(result.text).toContain("一句话判断");
    expect(result.text).toContain("韩**");
    expect(result.text).not.toBe("未找到对应顾客画像。");
  });

  it("prefers the serving query plane for customer follow-up list asks when runtime exposes it", async () => {
    const runtime = {
      buildReport: vi.fn(),
      getCurrentServingVersion: vi.fn().mockResolvedValue("serving-v1"),
      executeCompiledServingQuery: vi.fn().mockResolvedValue([
        {
          org_id: "1005",
          as_of_biz_date: "2026-03-30",
          customer_display_name: "李女士",
          member_card_no: "YB-001",
          primary_segment: "important-reactivation-member",
          pay_amount_90d: 4680,
          current_stored_amount: 980,
          current_silent_days: 42,
          top_tech_name: "安老师",
          followup_score: 72,
          risk_score: 63,
          priority_band: "P0",
          reason_summary: "已沉默42天，近90天消费4680.00元，优先联系安老师。",
          touch_advice_summary: "建议周四 after-work 联系，今天命中最佳窗口。",
        },
        {
          org_id: "1005",
          as_of_biz_date: "2026-03-30",
          customer_display_name: "陈女士",
          member_card_no: "YB-009",
          primary_segment: "important-reactivation-member",
          pay_amount_90d: 3260,
          current_stored_amount: 520,
          current_silent_days: 35,
          top_tech_name: "王老师",
          followup_score: 68,
          risk_score: 58,
          priority_band: "P1",
          reason_summary: "已沉默35天，近90天消费3260.00元，可排入本周召回。",
          touch_advice_summary: "建议本周五晚间联系。",
        },
      ]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yingbin",
        employeeName: "迎宾店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1005"],
      },
      text: "迎宾店高价值待唤回名单",
      now,
    });

    expect(result.text).toContain("迎宾店 2026-03-30 跟进名单");
    expect(result.text).toContain("1. 李女士");
    expect(result.text).toContain("2. 陈女士");
    expect(result.text).toContain("P0");
    expect(result.text).toContain("建议周四 after-work 联系");
    expect(runtime.buildReport).not.toHaveBeenCalled();
  });

  it("prefers the serving query plane for explicit customer-segment list asks when runtime exposes it", async () => {
    const runtime = {
      buildReport: vi.fn(),
      getCurrentServingVersion: vi.fn().mockResolvedValue("serving-v1"),
      executeCompiledServingQuery: vi.fn().mockResolvedValue([
        {
          org_id: "1005",
          as_of_biz_date: "2026-03-30",
          customer_display_name: "周先生",
          member_card_no: "YB-021",
          primary_segment: "sleeping-customer",
          pay_amount_90d: 1860,
          current_stored_amount: 320,
          current_silent_days: 46,
          top_tech_name: "安妮",
          followup_score: 66,
          risk_score: 58,
        },
        {
          org_id: "1005",
          as_of_biz_date: "2026-03-30",
          customer_display_name: "李女士",
          member_card_no: "YB-018",
          primary_segment: "sleeping-customer",
          pay_amount_90d: 980,
          current_stored_amount: 0,
          current_silent_days: 38,
          top_tech_name: "可可",
          followup_score: 51,
          risk_score: 49,
        },
      ]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yingbin",
        employeeName: "迎宾店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1005"],
      },
      text: "迎宾店沉睡会员名单",
      now,
    });

    expect(result.text).toContain("迎宾店 2026-03-30 沉睡会员名单");
    expect(result.text).toContain("1. 周先生");
    expect(result.text).toContain("2. 李女士");
    expect(result.text).toContain("近90天支付 1860.00 元");
    expect(result.text).toContain("当前沉默 46 天");
    expect(runtime.buildReport).not.toHaveBeenCalled();
  });

  it("prefers the serving query plane for explicit customer-segment count asks when runtime exposes it", async () => {
    const runtime = {
      buildReport: vi.fn(),
      getCurrentServingVersion: vi.fn().mockResolvedValue("serving-v1"),
      executeCompiledServingQuery: vi.fn().mockResolvedValue([
        {
          org_id: "1001",
          as_of_biz_date: "2026-03-30",
          primary_segment: "important-value-member",
          customer_count: 2,
          single_tech_loyal_count: 1,
          pay_amount_90d_total: 3000,
        },
      ]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yiwu",
        employeeName: "义乌店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1001"],
      },
      text: "重要价值会员有多少",
      now,
    });

    expect(result.text).toContain("义乌店 2026-03-30 重要价值会员 2 人");
    expect(result.text).toContain("单技师忠诚客户: 1 人");
    expect(result.text).toContain("近 90 天累计支付: 3000.00 元");
    expect(runtime.buildReport).not.toHaveBeenCalled();
  });

  it("uses the runtime customer query path for recharge-without-visit member asks", async () => {
    const runtime = {
      buildReport: vi.fn(),
      getCurrentServingVersion: vi.fn().mockResolvedValue("serving-v1"),
      executeCompiledServingQuery: vi.fn().mockResolvedValue([]),
      listCurrentMembers: vi.fn().mockResolvedValue([
        {
          orgId: "1005",
          memberId: "M001",
          name: "张女士",
          phone: "13800008888",
          storedAmount: 1000,
          consumeAmount: 0,
          createdTime: "2026-02-10 10:00:00",
          lastConsumeTime: undefined,
          silentDays: 49,
          rawJson: "{}",
        },
        {
          orgId: "1005",
          memberId: "M002",
          name: "李女士",
          phone: "13800009999",
          storedAmount: 600,
          consumeAmount: 0,
          createdTime: "2026-03-01 09:00:00",
          lastConsumeTime: undefined,
          silentDays: 29,
          rawJson: "{}",
        },
        {
          orgId: "1005",
          memberId: "M003",
          name: "王先生",
          phone: "13800007777",
          storedAmount: 200,
          consumeAmount: 800,
          createdTime: "2026-02-01 09:00:00",
          lastConsumeTime: "2026-03-25 21:00:00",
          silentDays: 5,
          rawJson: "{}",
        },
      ]),
      listRechargeBillsByDateRange: vi.fn().mockResolvedValue([
        {
          orgId: "1005",
          rechargeId: "R001",
          realityAmount: 1000,
          totalAmount: 1200,
          donateAmount: 200,
          antiFlag: false,
          optTime: "2026-03-10 12:00:00",
          bizDate: "2026-03-10",
          rawJson: JSON.stringify({
            MemberId: "M001",
            MemberName: "张女士",
            MemberPhone: "13800008888",
          }),
        },
        {
          orgId: "1005",
          rechargeId: "R002",
          realityAmount: 600,
          totalAmount: 600,
          donateAmount: 0,
          antiFlag: false,
          optTime: "2026-03-20 14:00:00",
          bizDate: "2026-03-20",
          rawJson: JSON.stringify({
            MemberId: "M002",
            MemberName: "李女士",
            MemberPhone: "13800009999",
          }),
        },
        {
          orgId: "1005",
          rechargeId: "R003",
          realityAmount: 300,
          totalAmount: 300,
          donateAmount: 0,
          antiFlag: false,
          optTime: "2026-03-18 16:00:00",
          bizDate: "2026-03-18",
          rawJson: JSON.stringify({
            MemberId: "M003",
            MemberName: "王先生",
            MemberPhone: "13800007777",
          }),
        },
      ]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yingbin",
        employeeName: "迎宾店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1005"],
      },
      text: "迎宾店谁充了钱还没来过",
      now,
    });

    expect(result.text).toContain("迎宾店 2026-03-30 充值未到店会员名单");
    expect(result.text).toContain("张女士");
    expect(result.text).toContain("李女士");
    expect(result.text).toContain("按当前已同步历史");
    expect(result.text).not.toContain("王先生");
    expect(runtime.executeCompiledServingQuery).not.toHaveBeenCalled();
  });

  it("prefers the serving query plane for segment tech-binding ranking asks when runtime exposes it", async () => {
    const runtime = {
      buildReport: vi.fn(),
      getCurrentServingVersion: vi.fn().mockResolvedValue("serving-v1"),
      executeCompiledServingQuery: vi.fn().mockResolvedValue([
        {
          org_id: "1001",
          as_of_biz_date: "2026-03-30",
          primary_segment: "important-value-member",
          tech_name: "杜莎",
          customer_count: 2,
        },
        {
          org_id: "1001",
          as_of_biz_date: "2026-03-30",
          primary_segment: "important-value-member",
          tech_name: "阿明",
          customer_count: 1,
        },
      ]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: {
        channel: "wecom",
        senderId: "manager-yiwu",
        employeeName: "义乌店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1001"],
      },
      text: "义乌店哪个技师绑定的高价值会员最多",
      now,
    });

    expect(result.text).toContain("义乌店 2026-03-30 重要价值会员绑定技师排名");
    expect(result.text).toContain("1. 杜莎 2 位");
    expect(result.text).toContain("2. 阿明 1 位");
    expect(runtime.buildReport).not.toHaveBeenCalled();
  });

  it("prefers the serving query plane for store ranking asks when runtime exposes it", async () => {
    const runtime = {
      buildReport: vi.fn(),
      getCurrentServingVersion: vi.fn().mockResolvedValue("serving-v1"),
      executeCompiledServingQuery: vi.fn().mockResolvedValue([
        {
          org_id: "1003",
          store_name: "华美店",
          window_end_biz_date: "2026-03-30",
          window_days: 7,
          service_revenue: 12600,
          average_ticket: 138,
          risk_score: 40,
        },
        {
          org_id: "1001",
          store_name: "义乌店",
          window_end_biz_date: "2026-03-30",
          window_days: 7,
          service_revenue: 9800,
          average_ticket: 132,
          risk_score: 48,
        },
      ]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "五店近7天营收排名",
      now,
    });

    expect(result.text).toContain("2店 近7天 服务营收排名");
    expect(result.text).toContain("1. 华美店");
    expect(result.text).toContain("2. 义乌店");
    expect(runtime.buildReport).not.toHaveBeenCalled();
  });

  it("prefers the serving query plane for point-clock ranking asks when runtime exposes it", async () => {
    const runtime = {
      buildReport: vi.fn(),
      getCurrentServingVersion: vi.fn().mockResolvedValue("serving-v1"),
      executeCompiledServingQuery: vi.fn().mockResolvedValue([
        {
          org_id: "1003",
          store_name: "华美店",
          window_end_biz_date: "2026-03-30",
          window_days: 7,
          service_revenue: 8600,
          average_ticket: 118,
          clock_effect: 82,
          point_clock_rate: 0.41,
          add_clock_rate: 0.22,
          risk_score: 42,
        },
        {
          org_id: "1001",
          store_name: "义乌店",
          window_end_biz_date: "2026-03-30",
          window_days: 7,
          service_revenue: 9800,
          average_ticket: 132,
          clock_effect: 81,
          point_clock_rate: 0.34,
          add_clock_rate: 0.19,
          risk_score: 48,
        },
      ]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "五店近7天点钟率排名",
      now,
    });

    expect(result.text).toContain("2店 近7天 点钟率排名");
    expect(result.text).toContain("1. 华美店 | 点钟率 41.0%");
    expect(result.text).toContain("2. 义乌店 | 点钟率 34.0%");
    expect(runtime.buildReport).not.toHaveBeenCalled();
  });

  it("prefers the serving query plane for customer-count ranking asks when runtime exposes it", async () => {
    const runtime = {
      buildReport: vi.fn(),
      getCurrentServingVersion: vi.fn().mockResolvedValue("serving-v1"),
      executeCompiledServingQuery: vi.fn().mockResolvedValue([
        {
          org_id: "1003",
          store_name: "华美店",
          window_end_biz_date: "2026-03-30",
          window_days: 7,
          metric_value: 312,
        },
        {
          org_id: "1001",
          store_name: "义乌店",
          window_end_biz_date: "2026-03-30",
          window_days: 7,
          metric_value: 289,
        },
      ]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "五店近7天客流排名",
      now,
    });

    expect(result.text).toContain("2店 近7天 消费人数排名");
    expect(result.text).toContain("1. 华美店 | 消费人数 312 人");
    expect(result.text).toContain("2. 义乌店 | 消费人数 289 人");
    expect(runtime.buildReport).not.toHaveBeenCalled();
  });

  it("prefers the serving query plane for day store ranking asks when runtime exposes it", async () => {
    const runtime = {
      buildReport: vi.fn(),
      getCurrentServingVersion: vi.fn().mockResolvedValue("serving-v1"),
      executeCompiledServingQuery: vi.fn().mockResolvedValue([
        {
          org_id: "1003",
          store_name: "华美店",
          biz_date: "2026-03-30",
          metric_value: 12600,
        },
        {
          org_id: "1001",
          store_name: "义乌店",
          biz_date: "2026-03-30",
          metric_value: 9800,
        },
      ]),
    };

    const result = await executeHetangQuery({
      runtime: runtime as never,
      config,
      binding: HQ_BINDING,
      text: "昨天各店营收排名",
      now,
    });

    expect(result.text).toContain("2店 2026-03-30 服务营收排名");
    expect(result.text).toContain("1. 华美店");
    expect(result.text).toContain("2. 义乌店");
    expect(runtime.buildReport).not.toHaveBeenCalled();
  });
});
