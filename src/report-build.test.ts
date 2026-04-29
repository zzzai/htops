import { describe, expect, it, vi } from "vitest";

const {
  computeDailyStoreMetricsMock,
  rebuildCustomerIntelligenceForBizDateMock,
} = vi.hoisted(() => ({
  computeDailyStoreMetricsMock: vi.fn(),
  rebuildCustomerIntelligenceForBizDateMock: vi.fn(),
}));

vi.mock("./metrics.js", () => ({
  computeDailyStoreMetrics: computeDailyStoreMetricsMock,
  formatMetricLine: vi.fn(),
  formatPercentValue: vi.fn(),
}));

vi.mock("./customer-intelligence.js", () => ({
  rebuildCustomerIntelligenceForBizDate: rebuildCustomerIntelligenceForBizDateMock,
}));

import { resolveHetangOpsConfig } from "./config.js";
import { buildDailyStoreReport } from "./report.js";
import type { DailyStoreMetrics } from "./types.js";

function buildMetrics(overrides: Partial<DailyStoreMetrics> = {}): DailyStoreMetrics {
  return {
    orgId: "1001",
    storeName: "一号店",
    bizDate: "2026-03-29",
    serviceRevenue: 3200,
    rechargeCash: 1000,
    rechargeStoredValue: 1200,
    rechargeBonusValue: 200,
    antiServiceRevenue: 0,
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
    groupbuyPlatformBreakdown: [],
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

function buildConfig() {
  return resolveHetangOpsConfig({
    api: {
      appKey: "demo-app-key",
      appSecret: "demo-app-secret",
    },
    database: {
      url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
    },
    stores: [{ orgId: "1001", storeName: "一号店" }],
  });
}

function buildCurrentTech(params: {
  techCode: string;
  techName: string;
  postName: string;
  itemList: Array<{ itemName: string; itemTypeName?: string; itemCategory?: number }>;
}) {
  return {
    orgId: "1001",
    techCode: params.techCode,
    techName: params.techName,
    isWork: true,
    isJob: true,
    pointClockNum: 0,
    wheelClockNum: 0,
    baseWages: 0,
    rawJson: JSON.stringify({
      PostName: params.postName,
      ItemList: params.itemList.map((item, index) => ({
        ItemName: item.itemName,
        ItemTypeName: item.itemTypeName ?? "",
        ItemCategory: item.itemCategory ?? 1,
        PersonId: `${params.techCode}-${index}`,
      })),
    }),
  };
}

function buildTechUpClockRow(params: {
  personCode: string;
  personName: string;
  itemName: string;
  clockType: string;
  addClockType?: number;
}) {
  return {
    orgId: "1001",
    rowFingerprint: `${params.personCode}-${params.itemName}-${params.clockType}-${params.addClockType ?? 0}`,
    personCode: params.personCode,
    personName: params.personName,
    settleNo: `NO-${params.personCode}`,
    itemName: params.itemName,
    clockType: params.clockType,
    count: 1,
    turnover: 100,
    comm: 30,
    settleTime: "2026-03-29 15:30:00",
    bizDate: "2026-03-29",
    rawJson: JSON.stringify({
      ClockType: params.clockType,
      AddClockType: params.addClockType ?? 0,
      ItemName: params.itemName,
    }),
  };
}

function buildConsumeBill(params: {
  settleId: string;
  settleNo: string;
  payAmount: number;
  consumeAmount: number;
}) {
  return {
    orgId: "1001",
    settleId: params.settleId,
    settleNo: params.settleNo,
    payAmount: params.payAmount,
    consumeAmount: params.consumeAmount,
    discountAmount: 0,
    antiFlag: false,
    optTime: "2026-03-29 16:00:00",
    bizDate: "2026-03-29",
    rawJson: JSON.stringify({
      SettleId: params.settleId,
      SettleNo: params.settleNo,
      Pay: params.payAmount,
      Consume: params.consumeAmount,
      Payments: [],
    }),
  };
}

describe("buildDailyStoreReport refresh orchestration", () => {
  it("writes all marts first and refreshes analytics views once", async () => {
    computeDailyStoreMetricsMock.mockResolvedValue({
      metrics: buildMetrics(),
      alerts: [{ code: "warn-low-revisit", severity: "warn", message: "复到店偏弱" }],
      suggestions: ["今天先盯二次到店承接。"],
    });
    rebuildCustomerIntelligenceForBizDateMock.mockResolvedValue({
      customerTechLinks: [],
      customerSegments: [],
      customerConversionCohorts: [],
    });

    const store = {
      listConsumeBillsByDate: vi.fn().mockResolvedValue([]),
      listTechUpClockByDate: vi.fn().mockResolvedValue([]),
      listCurrentTech: vi.fn().mockResolvedValue([]),
      listStoreReview7dByDateRange: vi.fn().mockResolvedValue([]),
      listStoreSummary30dByDateRange: vi.fn().mockResolvedValue([]),
      saveDailyMetrics: vi.fn().mockResolvedValue(undefined),
      replaceDailyAlerts: vi.fn().mockResolvedValue(undefined),
      saveDailyReport: vi.fn().mockResolvedValue(undefined),
      forceRebuildAnalyticsViews: vi.fn().mockResolvedValue(undefined),
    };

    await buildDailyStoreReport({
      config: buildConfig(),
      store: store as never,
      orgId: "1001",
      bizDate: "2026-03-29",
    });

    expect(store.saveDailyMetrics).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "1001", bizDate: "2026-03-29" }),
      expect.any(String),
      { refreshViews: false },
    );
    expect(rebuildCustomerIntelligenceForBizDateMock).toHaveBeenCalledWith({
      store,
      orgId: "1001",
      bizDate: "2026-03-29",
      updatedAt: expect.any(String),
      refreshViews: false,
      storeConfig: {
        orgId: "1001",
        storeName: "一号店",
        rawAliases: [],
        isActive: true,
        notification: undefined,
        customerGrowth: undefined,
        roomCount: undefined,
        operatingHoursPerDay: undefined,
        fixedMonthlyCost: undefined,
        variableCostRate: undefined,
        materialCostRate: undefined,
      },
    });
    expect(store.forceRebuildAnalyticsViews).toHaveBeenCalledTimes(1);
  });

  it("renders the formal daily report in store-manager detail format", async () => {
    computeDailyStoreMetricsMock.mockResolvedValue({
      metrics: buildMetrics({
        serviceRevenue: 26189,
        rechargeCash: 21000,
        storedConsumeAmount: 22470,
        highBalanceSleepingMemberCount: 1,
        highBalanceSleepingMemberAmount: 5000,
        firstChargeUnconsumedMemberCount: 2,
        firstChargeUnconsumedMemberAmount: 1200,
        memberRepurchaseBaseCustomerCount7d: 18,
        memberRepurchaseReturnedCustomerCount7d: 6,
        memberRepurchaseRate7d: 6 / 18,
        sleepingMembers: 20,
        sleepingMemberRate: 20 / 120,
        cashPaymentAmount: 586,
        wechatPaymentAmount: 1984,
        alipayPaymentAmount: 299,
        groupbuyAmount: 1606,
        groupbuyOrderCount: 5,
        groupbuyCohortCustomerCount: 0,
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
        groupbuyPlatformBreakdown: [
          { platform: "美团", orderCount: 4, orderShare: 0.07, amount: 1414, amountShare: 0.05 },
          { platform: "抖音", orderCount: 1, orderShare: 0.02, amount: 192, amountShare: 0.01 },
        ],
        onDutyTechCount: 4,
      }),
      alerts: [],
      suggestions: [],
    });
    rebuildCustomerIntelligenceForBizDateMock.mockResolvedValue({
      customerTechLinks: [],
      customerSegments: [],
      customerConversionCohorts: [],
    });

    const store = {
      listConsumeBillsByDate: vi.fn().mockResolvedValue([
        buildConsumeBill({
          settleId: "SETTLE-1",
          settleNo: "NO-1",
          payAmount: 12000,
          consumeAmount: 15000,
        }),
        buildConsumeBill({
          settleId: "SETTLE-2",
          settleNo: "NO-2",
          payAmount: 14189,
          consumeAmount: 17043,
        }),
      ]),
      listTechUpClockByDate: vi.fn().mockResolvedValue([
        buildTechUpClockRow({
          personCode: "S1",
          personName: "实力甲",
          itemName: "悦色足道",
          clockType: "1",
        }),
        buildTechUpClockRow({
          personCode: "S1",
          personName: "实力甲",
          itemName: "悦色足道",
          clockType: "1",
        }),
        buildTechUpClockRow({
          personCode: "S1",
          personName: "实力甲",
          itemName: "悦色足道",
          clockType: "3",
        }),
        buildTechUpClockRow({
          personCode: "S1",
          personName: "实力甲",
          itemName: "悦色足道",
          clockType: "2",
        }),
        buildTechUpClockRow({
          personCode: "S1",
          personName: "实力甲",
          itemName: "悦色足道",
          clockType: "4",
          addClockType: 1,
        }),
        buildTechUpClockRow({
          personCode: "M1",
          personName: "明星甲",
          itemName: "荷韵足道",
          clockType: "1",
        }),
        buildTechUpClockRow({
          personCode: "M1",
          personName: "明星甲",
          itemName: "荷韵足道",
          clockType: "2",
        }),
        buildTechUpClockRow({
          personCode: "S2",
          personName: "实力乙",
          itemName: "荷悦SPA",
          clockType: "1",
        }),
        buildTechUpClockRow({
          personCode: "S2",
          personName: "实力乙",
          itemName: "荷悦SPA",
          clockType: "2",
        }),
        buildTechUpClockRow({
          personCode: "S2",
          personName: "实力乙",
          itemName: "荷悦SPA加钟",
          clockType: "4",
          addClockType: 1,
        }),
        buildTechUpClockRow({
          personCode: "M1",
          personName: "明星甲",
          itemName: "禅悦SPA",
          clockType: "2",
        }),
        buildTechUpClockRow({
          personCode: "E1",
          personName: "采耳甲",
          itemName: "荷塘采耳",
          clockType: "1",
        }),
        buildTechUpClockRow({
          personCode: "E1",
          personName: "采耳甲",
          itemName: "耳部护理",
          clockType: "1",
        }),
        buildTechUpClockRow({
          personCode: "S1",
          personName: "实力甲",
          itemName: "全天场小项",
          clockType: "1",
        }),
      ]),
      listCurrentTech: vi.fn().mockResolvedValue([
        buildCurrentTech({
          techCode: "S1",
          techName: "实力甲",
          postName: "实力技师",
          itemList: [
            { itemName: "悦色足道", itemTypeName: "足浴类", itemCategory: 1 },
            { itemName: "全天场小项", itemTypeName: "小项类", itemCategory: 1 },
          ],
        }),
        buildCurrentTech({
          techCode: "S2",
          techName: "实力乙",
          postName: "实力技师",
          itemList: [
            { itemName: "荷悦SPA", itemTypeName: "按摩类", itemCategory: 1 },
            { itemName: "悦色足道", itemTypeName: "足浴类", itemCategory: 1 },
          ],
        }),
        buildCurrentTech({
          techCode: "M1",
          techName: "明星甲",
          postName: "明星技师",
          itemList: [
            { itemName: "荷韵足道", itemTypeName: "足浴类", itemCategory: 1 },
            { itemName: "禅悦SPA", itemTypeName: "按摩类", itemCategory: 1 },
          ],
        }),
        buildCurrentTech({
          techCode: "E1",
          techName: "采耳甲",
          postName: "附项技师",
          itemList: [
            { itemName: "荷塘采耳", itemTypeName: "附项类", itemCategory: 2 },
            { itemName: "耳部护理", itemTypeName: "附项类", itemCategory: 2 },
          ],
        }),
      ]),
      listStoreReview7dByDateRange: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          windowEndBizDate: "2026-03-29",
          storeName: "一号店",
          revenue7d: 150000,
          orderCount7d: 400,
          totalClocks7d: 800,
          clockEffect7d: 187.5,
          averageTicket7d: 375,
          pointClockRate7d: 0.5,
          addClockRate7d: 0.25,
          rechargeCash7d: 50000,
          storedConsumeAmount7d: 70000,
          storedConsumeRate7d: 1.4,
          onDutyTechCount7d: 6,
          groupbuyOrderShare7d: 0.2,
          groupbuyCohortCustomerCount: 0,
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
          sleepingMembers: 20,
          sleepingMemberRate: 20 / 120,
          newMembers7d: 18,
          activeTechCount7d: 6,
          currentStoredBalance: 15000,
          storedBalanceLifeMonths: 1.2,
          renewalPressureIndex30d: 1.1,
          memberRepurchaseBaseCustomerCount7d: 20,
          memberRepurchaseReturnedCustomerCount7d: 3,
          memberRepurchaseRate7d: 3 / 20,
        },
      ]),
      listStoreSummary30dByDateRange: vi.fn().mockResolvedValue([]),
      saveDailyMetrics: vi.fn().mockResolvedValue(undefined),
      replaceDailyAlerts: vi.fn().mockResolvedValue(undefined),
      saveDailyReport: vi.fn().mockResolvedValue(undefined),
      forceRebuildAnalyticsViews: vi.fn().mockResolvedValue(undefined),
    };

    const report = await buildDailyStoreReport({
      config: buildConfig(),
      store: store as never,
      orgId: "1001",
      bizDate: "2026-03-29",
    });

    expect(report.markdown).toContain("2026年3月29日 一号店经营数据报告");
    expect(report.markdown).toContain("营业日口径：次日03:00截止");
    expect(report.markdown).toContain("【技师出勤】  \n实力2位 / 明星1位 / SPA0位");
    expect(report.markdown).toContain("采耳1位 / 小项0位 / 共计4位");
    expect(report.markdown).toContain("【钟数结构】  \n实力：排2 / 选1 / 点1 / 加1 / 小计5");
    expect(report.markdown).toContain("实力：排2 / 选1 / 点1 / 加1 / 小计5");
    expect(report.markdown).toContain("明星：排1 / 选0 / 点1 / 加0 / 小计2");
    expect(report.markdown).toContain("实力SPA：排1 / 选0 / 点1 / 加1 / 小计3");
    expect(report.markdown).toContain("明星SPA：排0 / 选0 / 点1 / 加0 / 小计1");
    expect(report.markdown).toContain("【核心经营】  \n主项总钟数：7个");
    expect(report.markdown).toContain("主项总钟数：7个");
    expect(report.markdown).toContain("预估到店人数：16人");
    expect(report.markdown).toContain("采耳钟数：2个");
    expect(report.markdown).toContain("小项钟数：1个");
    expect(report.markdown).toContain("点钟率：50%");
    expect(report.markdown).toContain("加钟率：25%");
    expect(report.markdown).toContain("会员卡：实充21000元 / 实耗22470元");
    expect(report.markdown).toContain("线上：美团1414元 + 抖音192元");
    expect(report.markdown).toContain("线上小计：1606元");
    expect(report.markdown).toContain("线下：现金586元 + 微信1984元 + 支付宝299元");
    expect(report.markdown).toContain("线下小计：2869元");
    expect(report.markdown).toContain("营收：总32043元 / 实收26189元");
    expect(report.markdown).toContain("现金业绩：25475元");
    expect(report.markdown).toContain("【经营分析】  \n经营判断：");
    expect(report.markdown).toContain("经营判断：");
    expect(report.markdown).toContain("会员复购：");
    expect(report.markdown).toContain("今日重心：");
    expect(report.markdown).toContain("【今日动作】  \n1. 会员回流");
    expect(report.markdown).toContain("对象：高余额沉默会员");
    expect(report.markdown).toContain("2. 团购承接");
    expect(report.markdown).toContain("3. 高峰放大");
    expect(report.markdown).toContain("目标：");
    expect(report.markdown).toContain("会员7天复购率：15% (3/20)");
    expect(report.markdown).toContain("高余额沉默会员：1人 / 5000元");
    expect(report.markdown).toContain("首充未耗卡：2人 / 1200元");
    expect(report.markdown).not.toContain("团购转化漏斗：");
    expect(report.markdown).not.toContain("团购转化链路当前团购样本不足或身份待补齐，暂不下漏斗判断。");
    expect(report.markdown).not.toContain("样本不足");
    expect(report.markdown).not.toContain("待补齐");
    expect(report.markdown).not.toContain("7天复到店率：N/A");
    expect(report.markdown).not.toContain("7天开卡率：N/A");
    expect(report.markdown).not.toContain("7天储值转化率：N/A");
    expect(report.markdown).not.toContain("30天会员消费转化率：N/A");
    expect(report.markdown).not.toContain("团购首单客转高价值会员率：N/A");
    expect(report.markdown).not.toContain("【详细指标】");
    expect(report.markdown).not.toContain("服务营收：");
    expect(report.markdown).not.toContain("技师：在岗");
    expect(report.markdown.indexOf("点钟率：50%")).toBeLessThan(
      report.markdown.indexOf("【经营分析】"),
    );
    expect(report.markdown).not.toContain(
      "注：包间上座率/翻房率、毛利/净利/保本点、CAC/活动ROI需补充房间/成本/营销配置后再进入正式分析。",
    );
  });

  it("prefers historical tech snapshot profiles over current profiles when rendering daily attendance", async () => {
    computeDailyStoreMetricsMock.mockResolvedValue({
      metrics: buildMetrics({
        serviceRevenue: 5000,
        rechargeCash: 1000,
        storedConsumeAmount: 2000,
        cashPaymentAmount: 300,
        wechatPaymentAmount: 500,
        alipayPaymentAmount: 200,
        groupbuyAmount: 600,
        groupbuyOrderCount: 2,
        groupbuyPlatformBreakdown: [
          { platform: "美团", orderCount: 2, orderShare: 0.2, amount: 600, amountShare: 0.12 },
        ],
      }),
      alerts: [],
      suggestions: [],
    });
    rebuildCustomerIntelligenceForBizDateMock.mockResolvedValue({
      customerTechLinks: [],
      customerSegments: [],
      customerConversionCohorts: [],
    });

    const store = {
      listConsumeBillsByDate: vi.fn().mockResolvedValue([
        buildConsumeBill({
          settleId: "SETTLE-1",
          settleNo: "NO-1",
          payAmount: 5000,
          consumeAmount: 5600,
        }),
      ]),
      listTechUpClockByDate: vi.fn().mockResolvedValue([
        buildTechUpClockRow({
          personCode: "S1",
          personName: "技师甲",
          itemName: "悦色足道",
          clockType: "1",
        }),
        buildTechUpClockRow({
          personCode: "E1",
          personName: "技师乙",
          itemName: "荷塘采耳",
          clockType: "1",
        }),
      ]),
      listCurrentTech: vi.fn().mockResolvedValue([
        buildCurrentTech({
          techCode: "S1",
          techName: "技师甲",
          postName: "明星技师",
          itemList: [{ itemName: "悦色足道", itemTypeName: "足浴类", itemCategory: 1 }],
        }),
        buildCurrentTech({
          techCode: "E1",
          techName: "技师乙",
          postName: "实力技师",
          itemList: [{ itemName: "荷塘采耳", itemTypeName: "附项类", itemCategory: 2 }],
        }),
      ]),
      listTechDailySnapshotByDate: vi.fn().mockResolvedValue([
        buildCurrentTech({
          techCode: "S1",
          techName: "技师甲",
          postName: "实力技师",
          itemList: [{ itemName: "悦色足道", itemTypeName: "足浴类", itemCategory: 1 }],
        }),
        buildCurrentTech({
          techCode: "E1",
          techName: "技师乙",
          postName: "附项技师",
          itemList: [{ itemName: "荷塘采耳", itemTypeName: "附项类", itemCategory: 2 }],
        }),
      ]),
      listStoreReview7dByDateRange: vi.fn().mockResolvedValue([]),
      listStoreSummary30dByDateRange: vi.fn().mockResolvedValue([]),
      saveDailyMetrics: vi.fn().mockResolvedValue(undefined),
      replaceDailyAlerts: vi.fn().mockResolvedValue(undefined),
      saveDailyReport: vi.fn().mockResolvedValue(undefined),
      forceRebuildAnalyticsViews: vi.fn().mockResolvedValue(undefined),
    };

    const report = await buildDailyStoreReport({
      config: buildConfig(),
      store: store as never,
      orgId: "1001",
      bizDate: "2026-03-29",
    });

    expect(report.markdown).toContain("实力1位 / 明星0位 / SPA0位");
    expect(report.markdown).toContain("采耳1位 / 小项0位 / 共计2位");
    expect(report.markdown).toContain("实力：排1 / 选0 / 点0 / 加0 / 小计1");
    expect(report.markdown).toContain("采耳钟数：1个");
    expect(report.markdown).toContain("小项钟数：0个");
  });
});
