import { describe, expect, it } from "vitest";
import {
  renderMetricQueryResponse,
  resolveMetricIntent,
  type HetangSupportedMetricKey,
} from "./metric-query.js";
import type { DailyStoreMetrics, DailyStoreReport } from "./types.js";

function buildMetrics(overrides: Partial<DailyStoreMetrics> = {}): DailyStoreMetrics {
  return {
    orgId: "627150985244677",
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

describe("resolveMetricIntent", () => {
  it.each([
    ["义乌店昨天反结金额", "antiServiceRevenue"],
    ["义乌店昨天订单数", "serviceOrderCount"],
    ["义乌店昨天单数", "serviceOrderCount"],
    ["义乌店昨天单均金额", "orderAverageAmount"],
    ["义乌店昨天客数", "customerCount"],
    ["义乌店昨天客流量", "customerCount"],
    ["义乌店昨天充值总额", "rechargeStoredValue"],
    ["义乌店昨天储值", "rechargeStoredValue"],
    ["义乌店昨天储值多少", "rechargeStoredValue"],
    ["义乌店近三天储值", "rechargeStoredValue"],
    ["义乌店近7天储值", "rechargeStoredValue"],
    ["义乌店昨天充值赠送", "rechargeBonusValue"],
    ["义乌店昨天上钟产值", "clockRevenue"],
    ["义乌店昨天技师提成金额", "techCommission"],
    ["义乌店昨天推销营收", "marketRevenue"],
    ["义乌店昨天推销提成", "marketCommission"],
    ["义乌店昨天团购单数", "groupbuyOrderCount"],
    ["义乌店昨天团购金额", "groupbuyAmount"],
    ["义乌店昨天团购复到店人数", "groupbuyRevisitCustomerCount"],
    ["义乌店昨天团购后会员支付转化人数", "groupbuyMemberPayConvertedCustomerCount"],
    ["义乌店昨天7天复到店率", "groupbuy7dRevisitRate"],
    ["义乌店昨天7天开卡率", "groupbuy7dCardOpenedRate"],
    ["义乌店昨天7天储值转化率", "groupbuy7dStoredValueConversionRate"],
    ["义乌店昨天30天会员消费转化率", "groupbuy30dMemberPayConversionRate"],
    ["义乌店昨天团购首单客转高价值会员率", "groupbuyFirstOrderHighValueMemberRate"],
    ["义乌店昨天包间上座率", "roomOccupancyRate"],
    ["义乌店昨天翻房率", "roomTurnoverRate"],
    ["义乌店昨天毛利率", "grossMarginRate"],
    ["义乌店昨天净利率", "netMarginRate"],
    ["义乌店昨天保本营收", "breakEvenRevenue"],
    ["义乌店昨天到店人数", "customerCount"],
    ["义乌店昨天实充", "rechargeCash"],
    ["义乌店昨天充卡总额", "rechargeStoredValue"],
    ["义乌店昨天赠送额", "rechargeBonusValue"],
    ["义乌店昨天销售提成", "marketCommission"],
    ["义乌店昨天房间上座率", "roomOccupancyRate"],
    ["义乌店昨天保本点", "breakEvenRevenue"],
    ["迎宾店哪个技师点钟最高", "pointClockRate"],
  ])("maps %s to the correct metric key", (text, expectedKey) => {
    const resolution = resolveMetricIntent(text);

    expect(resolution.supported.map((entry) => entry.key)).toContain(
      expectedKey as HetangSupportedMetricKey,
    );
  });

  it("expands generic payment-structure phrasing into the payment share bundle", () => {
    const resolution = resolveMetricIntent("义乌店昨天收款方式占比逐个列一下");

    expect(resolution.supported.map((entry) => entry.key)).toEqual(
      expect.arrayContaining([
        "memberPaymentShare",
        "cashPaymentShare",
        "wechatPaymentShare",
        "alipayPaymentShare",
        "groupbuyAmountShare",
      ]),
    );
  });

  it("expands grouped payment and platform phrasing into the correct amount/share metrics", () => {
    const paymentAmounts = resolveMetricIntent("义乌店昨天微信和现金分别多少");
    const paymentShares = resolveMetricIntent("义乌店昨天微信现金会员团购占比");
    const platformAmounts = resolveMetricIntent("义乌店昨天美团和抖音分别多少");
    const platformOrderShares = resolveMetricIntent("义乌店昨天美团抖音单数占比");
    const platformStructure = resolveMetricIntent("义乌店昨天团购平台占比分布");

    expect(paymentAmounts.supported.map((entry) => entry.key)).toEqual(
      expect.arrayContaining(["wechatPaymentAmount", "cashPaymentAmount"]),
    );
    expect(paymentShares.supported.map((entry) => entry.key)).toEqual(
      expect.arrayContaining([
        "wechatPaymentShare",
        "cashPaymentShare",
        "memberPaymentShare",
        "groupbuyAmountShare",
      ]),
    );
    expect(platformAmounts.supported.map((entry) => entry.key)).toEqual(
      expect.arrayContaining(["meituanGroupbuyAmount", "douyinGroupbuyAmount"]),
    );
    expect(platformOrderShares.supported.map((entry) => entry.key)).toEqual(
      expect.arrayContaining(["meituanGroupbuyOrderShare", "douyinGroupbuyOrderShare"]),
    );
    expect(platformStructure.supported.map((entry) => entry.key)).toEqual(
      expect.arrayContaining(["meituanGroupbuyAmountShare", "douyinGroupbuyAmountShare"]),
    );
  });

  it("treats point/add clock shorthand and count asks as clock KPI asks instead of total clock count", () => {
    const pointCount = resolveMetricIntent("义乌店昨天点钟数量");
    const addCount = resolveMetricIntent("义乌店昨天加钟数量");
    const pointBare = resolveMetricIntent("义乌店昨天点钟");
    const addBare = resolveMetricIntent("义乌店昨天加钟");
    const typoTotalClock = resolveMetricIntent("义乌店昨天总种数");
    const combinedClock = resolveMetricIntent("义乌店近3天的点加钟情况");

    expect(pointCount.supported.map((entry) => entry.key)).toContain("pointClockRate");
    expect(pointCount.supported.map((entry) => entry.key)).not.toContain("totalClockCount");
    expect(addCount.supported.map((entry) => entry.key)).toContain("addClockRate");
    expect(addCount.supported.map((entry) => entry.key)).not.toContain("totalClockCount");
    expect(pointBare.supported.map((entry) => entry.key)).toContain("pointClockRate");
    expect(addBare.supported.map((entry) => entry.key)).toContain("addClockRate");
    expect(typoTotalClock.supported.map((entry) => entry.key)).toContain("totalClockCount");
    expect(combinedClock.supported.map((entry) => entry.key)).toEqual(
      expect.arrayContaining(["pointClockRate", "addClockRate"]),
    );
  });

  it.each([
    ["义乌店昨天营业收入", "serviceRevenue"],
    ["义乌店昨天反结额", "antiServiceRevenue"],
    ["义乌店昨天单量", "serviceOrderCount"],
    ["义乌店昨天上客人数", "customerCount"],
    ["义乌店昨天单钟产值", "clockEffect"],
    ["义乌店昨天上钟金额", "clockRevenue"],
    ["义乌店昨天团购单量", "groupbuyOrderCount"],
    ["义乌店昨天团购回头率", "groupbuyRevisitRate"],
    ["义乌店昨天7天回头率", "groupbuy7dRevisitRate"],
    ["义乌店昨天7天办卡率", "groupbuy7dCardOpenedRate"],
    ["义乌店昨天7天转储值率", "groupbuy7dStoredValueConversionRate"],
    ["义乌店昨天30天转会员消费率", "groupbuy30dMemberPayConversionRate"],
    ["义乌店当前卡余额", "currentStoredBalance"],
    ["义乌店卡里还有多少", "currentStoredBalance"],
    ["义乌店会员卡还有多少", "currentStoredBalance"],
    ["义乌店昨天技师提成率", "techCommissionRate"],
  ])("maps colloquial metric ask %s to %s", (text, expectedKey) => {
    const resolution = resolveMetricIntent(text);

    expect(resolution.supported.map((entry) => entry.key)).toContain(
      expectedKey as HetangSupportedMetricKey,
    );
  });

  it("does not over-expand 团购单量 into the generic service order metric", () => {
    const resolution = resolveMetricIntent("义乌店昨天团购单量");

    expect(resolution.supported.map((entry) => entry.key)).toContain("groupbuyOrderCount");
    expect(resolution.supported.map((entry) => entry.key)).not.toContain("serviceOrderCount");
  });

  it("treats bare 储值 in metric lists as recharge stored value instead of dropping it", () => {
    const resolution = resolveMetricIntent("义乌店近三天营收、单数、客单价、储值");

    expect(resolution.supported.map((entry) => entry.key)).toEqual(
      expect.arrayContaining([
        "serviceRevenue",
        "serviceOrderCount",
        "averageTicket",
        "rechargeStoredValue",
      ]),
    );
  });

  it("maps 团购订单量 to the groupbuy order metric without leaking into service orders", () => {
    const resolution = resolveMetricIntent("义乌店昨天团购订单量");

    expect(resolution.supported.map((entry) => entry.key)).toContain("groupbuyOrderCount");
    expect(resolution.supported.map((entry) => entry.key)).not.toContain("serviceOrderCount");
  });
});

describe("renderMetricQueryResponse", () => {
  it("renders the newly exposed field-backed metrics with correct units", () => {
    const text = renderMetricQueryResponse({
      storeName: "义乌店",
      bizDate: "2026-03-30",
      metrics: buildMetrics(),
      complete: true,
      resolution: {
        supported: [
          { key: "antiServiceRevenue", label: "反结金额" },
          { key: "serviceOrderCount", label: "服务单数" },
          { key: "orderAverageAmount", label: "单均金额" },
          { key: "customerCount", label: "消费人数" },
          { key: "rechargeStoredValue", label: "充值总额（含赠送）" },
          { key: "rechargeBonusValue", label: "充值赠送金额" },
          { key: "clockRevenue", label: "上钟产值" },
          { key: "techCommission", label: "技师提成金额" },
          { key: "marketRevenue", label: "推销营收" },
          { key: "marketCommission", label: "推销提成" },
          { key: "groupbuyOrderCount", label: "团购单数" },
          { key: "groupbuyAmount", label: "团购金额" },
          { key: "groupbuyRevisitCustomerCount", label: "团购复到店人数" },
          { key: "groupbuyMemberPayConvertedCustomerCount", label: "团购后会员支付转化人数" },
          { key: "roomOccupancyRate", label: "包间上座率" },
          { key: "roomTurnoverRate", label: "翻房率" },
          { key: "grossMarginRate", label: "毛利率" },
          { key: "netMarginRate", label: "净利率" },
          { key: "breakEvenRevenue", label: "保本营收" },
        ],
        unsupported: [],
      },
    });

    expect(text).toContain("反结金额: 120.00 元");
    expect(text).toContain("服务单数: 16 单");
    expect(text).toContain("单均金额: 200.00 元");
    expect(text).toContain("消费人数: 16 人");
    expect(text).toContain("充值总额（含赠送）: 1200.00 元");
    expect(text).toContain("充值赠送金额: 200.00 元");
    expect(text).toContain("上钟产值: 2800.00 元");
    expect(text).toContain("技师提成金额: 980.00 元");
    expect(text).toContain("推销营收: 480.00 元");
    expect(text).toContain("推销提成: 96.00 元");
    expect(text).toContain("团购单数: 4 单");
    expect(text).toContain("团购金额: 720.00 元");
    expect(text).toContain("团购复到店人数: 2 人");
    expect(text).toContain("团购后会员支付转化人数: 1 人");
    expect(text).toContain("包间上座率: 75.0%");
    expect(text).toContain("翻房率: 3.20 次/间");
    expect(text).toContain("毛利率: 55.0%");
    expect(text).toContain("净利率: 18.0%");
    expect(text).toContain("保本营收: 2500.00 元");
  });

  it("renders the new business-facing groupbuy funnel metrics with boss-readable ratios", () => {
    const text = renderMetricQueryResponse({
      storeName: "义乌店",
      bizDate: "2026-03-30",
      metrics: buildMetrics(),
      complete: true,
      resolution: {
        supported: [
          { key: "groupbuy7dRevisitRate", label: "7天复到店率" },
          { key: "groupbuy7dCardOpenedRate", label: "7天开卡率" },
          { key: "groupbuy7dStoredValueConversionRate", label: "7天储值转化率" },
          { key: "groupbuy30dMemberPayConversionRate", label: "30天会员消费转化率" },
          { key: "groupbuyFirstOrderHighValueMemberRate", label: "团购首单客转高价值会员率" },
        ],
        unsupported: [],
      },
    });

    expect(text).toContain("7天复到店率: 33.3%（2/6）");
    expect(text).toContain("7天开卡率: 16.7%（1/6）");
    expect(text).toContain("7天储值转化率: 16.7%（1/6）");
    expect(text).toContain("30天会员消费转化率: 16.7%（1/6）");
    expect(text).toContain("团购首单客转高价值会员率: 25.0%（1/4）");
    expect(text).toContain("近 30 天团购客滚动样本");
  });

  it("keeps explanatory notes for payment splits and clock-rate metrics", () => {
    const text = renderMetricQueryResponse({
      storeName: "义乌店",
      bizDate: "2026-03-30",
      metrics: buildMetrics(),
      complete: true,
      resolution: {
        supported: [
          { key: "memberPaymentShare", label: "会员消费占比" },
          { key: "cashPaymentShare", label: "现金消费占比" },
          { key: "pointClockRate", label: "点钟率" },
          { key: "addClockRate", label: "加钟率" },
        ],
        unsupported: [],
      },
    });

    expect(text).toContain("会员消费占比: 65.0%");
    expect(text).toContain("现金消费占比: 8.0%");
    expect(text).toContain("点钟率: 50.0%（10/20）");
    expect(text).toContain("加钟率: 25.0%（5/20）");
    expect(text).toContain("Payments 实付拆分统计");
    expect(text).toContain("按技师上钟明细条数口径");
  });

  it("surfaces point and add clock counts alongside the rate lines", () => {
    const text = renderMetricQueryResponse({
      storeName: "义乌店",
      bizDate: "近5天",
      metrics: buildMetrics(),
      complete: true,
      resolution: {
        supported: [
          { key: "pointClockRate", label: "点钟率" },
          { key: "addClockRate", label: "加钟率" },
        ],
        unsupported: [],
      },
    });

    expect(text).toContain("点钟数量: 10 个");
    expect(text).toContain("点钟率: 50.0%（10/20）");
    expect(text).toContain("加钟数量: 5 个");
    expect(text).toContain("加钟率: 25.0%（5/20）");
  });

  it("uses clock-specific incomplete wording for daily add-clock breakdowns", () => {
    const completeReport: DailyStoreReport = {
      orgId: "627150985244677",
      storeName: "义乌店",
      bizDate: "2026-03-29",
      metrics: buildMetrics({
        bizDate: "2026-03-29",
        upClockRecordCount: 20,
        addClockRecordCount: 5,
        addClockRate: 5 / 20,
      }),
      alerts: [],
      suggestions: [],
      markdown: "",
      complete: true,
    };
    const incompleteReport: DailyStoreReport = {
      orgId: "627150985244677",
      storeName: "义乌店",
      bizDate: "2026-03-30",
      metrics: buildMetrics({
        bizDate: "2026-03-30",
        upClockRecordCount: 0,
        addClockRecordCount: 0,
        addClockRate: null,
        incompleteSync: true,
        unavailableMetrics: ["addClockRate"],
      }),
      alerts: [],
      suggestions: [],
      markdown: "",
      complete: false,
    };

    const text = renderMetricQueryResponse({
      storeName: "义乌店",
      bizDate: "近2天",
      metrics: buildMetrics({
        upClockRecordCount: 20,
        addClockRecordCount: 5,
        addClockRate: 5 / 20,
        incompleteSync: true,
      }),
      complete: false,
      resolution: {
        supported: [{ key: "addClockRate", label: "加钟率" }],
        unsupported: [],
      },
      dailyReports: [completeReport, incompleteReport],
      showDailyBreakdown: true,
    });

    expect(text).toContain("2026-03-29：加钟数量 5 个，加钟率 25.0%（5/20）");
    expect(text).toContain("2026-03-30：加钟明细待补齐，暂不输出当日加钟数量/加钟率");
    expect(text).not.toContain("2026-03-30：加钟率 明细待补齐，暂不输出当日分天口径");
  });

  it("renders groupbuy platform metrics with the correct labels and units", () => {
    const text = renderMetricQueryResponse({
      storeName: "义乌店",
      bizDate: "2026-03-30",
      metrics: buildMetrics(),
      complete: true,
      resolution: {
        supported: [
          { key: "meituanGroupbuyAmount", label: "美团团购金额" },
          { key: "meituanGroupbuyAmountShare", label: "美团团购金额占比" },
          { key: "meituanGroupbuyOrderCount", label: "美团团购单数" },
          { key: "douyinGroupbuyAmount", label: "抖音团购金额" },
          { key: "douyinGroupbuyOrderShare", label: "抖音团购单数占比" },
        ],
        unsupported: [],
      },
    });

    expect(text).toContain("美团团购金额: 560.00 元");
    expect(text).toContain("美团团购金额占比: 17.5%");
    expect(text).toContain("美团团购单数: 3 单");
    expect(text).toContain("抖音团购金额: 160.00 元");
    expect(text).toContain("抖音团购单数占比: 6.3%");
  });
});
