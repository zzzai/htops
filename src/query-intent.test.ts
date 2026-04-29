import { describe, expect, it } from "vitest";
import { resolveHetangOpsConfig } from "./config.js";
import { resolveHetangQueryIntent } from "./query-intent.js";

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
        storeName: "义乌店",
      },
      {
        orgId: "1002",
        storeName: "园中园店",
      },
      {
        orgId: "1003",
        storeName: "华美店",
      },
      {
        orgId: "1004",
        storeName: "锦苑店",
      },
      {
        orgId: "1005",
        storeName: "迎宾店",
      },
    ],
  });
}

describe("resolveHetangQueryIntent", () => {
  const config = buildConfig();
  const now = new Date("2026-03-30T09:00:00+08:00");

  it("parses compare queries across stores", () => {
    const query = resolveHetangQueryIntent({
      config,
      text: "义乌店和园中园店昨天营收对比",
      now,
    });

    expect(query).toMatchObject({
      kind: "compare",
      explicitOrgIds: ["1001", "1002"],
      timeFrame: {
        kind: "single",
        bizDate: "2026-03-29",
      },
      metrics: [{ key: "serviceRevenue", label: "服务营收" }],
    });
  });

  it("parses store ranking queries over all stores", () => {
    const query = resolveHetangQueryIntent({
      config,
      text: "昨天五店营收排名",
      now,
    });

    expect(query).toMatchObject({
      kind: "ranking",
      rankingTarget: "store",
      rankingOrder: "desc",
      allStoresRequested: true,
      timeFrame: {
        kind: "single",
        bizDate: "2026-03-29",
      },
      metrics: [{ key: "serviceRevenue", label: "服务营收" }],
    });
  });

  it("parses reverse ranking and richer compare phrasing", () => {
    const ranking = resolveHetangQueryIntent({
      config,
      text: "昨天各店营收倒数排名",
      now,
    });
    const compare = resolveHetangQueryIntent({
      config,
      text: "义乌店今天营收比昨天怎么样",
      now,
    });

    expect(ranking).toMatchObject({
      kind: "ranking",
      rankingTarget: "store",
      rankingOrder: "asc",
      allStoresRequested: true,
    });
    expect(compare).toMatchObject({
      kind: "compare",
      explicitOrgIds: ["1001"],
      timeFrame: {
        kind: "single",
        bizDate: "2026-03-30",
      },
      comparisonTimeFrame: {
        kind: "single",
        bizDate: "2026-03-29",
      },
    });
  });

  it("parses anomaly queries with an explicit 7-day window", () => {
    const query = resolveHetangQueryIntent({
      config,
      text: "义乌店近7天营收下滑原因",
      now,
    });

    expect(query).toMatchObject({
      kind: "anomaly",
      explicitOrgIds: ["1001"],
      timeFrame: {
        kind: "range",
        startBizDate: "2026-03-23",
        endBizDate: "2026-03-29",
      },
      metrics: [{ key: "serviceRevenue", label: "服务营收" }],
    });
  });

  it("parses no-store direct metric queries so binding can resolve the effective scope later", () => {
    const query = resolveHetangQueryIntent({
      config,
      text: "昨天营收",
      now,
    });

    expect(query).toMatchObject({
      kind: "metric",
      explicitOrgIds: [],
      timeFrame: {
        kind: "single",
        bizDate: "2026-03-29",
      },
      metrics: [{ key: "serviceRevenue", label: "服务营收" }],
    });
  });

  it("parses previous-day aliases like 前一日 into the prior report day", () => {
    const query = resolveHetangQueryIntent({
      config,
      text: "华美店前一日运营日报",
      now,
    });

    expect(query).toMatchObject({
      kind: "report",
      explicitOrgIds: ["1003"],
      timeFrame: {
        kind: "single",
        bizDate: "2026-03-28",
        label: "前一日",
      },
    });
  });

  it("treats fuzzy 这几天 metric asks as a 5-day store window with point/add clock metrics", () => {
    const query = resolveHetangQueryIntent({
      config,
      text: "这几天义乌店的点钟率多少？加钟多少？",
      now,
    });

    expect(query).toMatchObject({
      kind: "metric",
      explicitOrgIds: ["1001"],
      timeFrame: {
        kind: "range",
        startBizDate: "2026-03-25",
        endBizDate: "2026-03-29",
        label: "近5天",
        days: 5,
      },
      metrics: [
        { key: "pointClockRate", label: "点钟率" },
        { key: "addClockRate", label: "加钟率" },
      ],
    });
  });

  it("treats fuzzy 近几天 metric asks as the same 5-day store window", () => {
    const query = resolveHetangQueryIntent({
      config,
      text: "近几天义乌店的点钟率多少？加钟多少？",
      now,
    });

    expect(query).toMatchObject({
      kind: "metric",
      explicitOrgIds: ["1001"],
      timeFrame: {
        kind: "range",
        startBizDate: "2026-03-25",
        endBizDate: "2026-03-29",
        label: "近5天",
        days: 5,
      },
      metrics: [
        { key: "pointClockRate", label: "点钟率" },
        { key: "addClockRate", label: "加钟率" },
      ],
    });
  });

  it("parses Chinese numeral relative day windows like 近三天 as an explicit 3-day range", () => {
    const query = resolveHetangQueryIntent({
      config,
      text: "义乌店近三天客流量",
      now,
    });

    expect(query).toMatchObject({
      kind: "metric",
      explicitOrgIds: ["1001"],
      timeFrame: {
        kind: "range",
        startBizDate: "2026-03-27",
        endBizDate: "2026-03-29",
        label: "近三天",
        days: 3,
      },
      metrics: [{ key: "customerCount", label: "消费人数" }],
    });
  });

  it("parses colloquial point/add clock status asks into the same 5-day metric window", () => {
    const query = resolveHetangQueryIntent({
      config,
      text: "华美店 近几天的加钟 点钟 情况",
      now,
    });

    expect(query).toMatchObject({
      kind: "metric",
      explicitOrgIds: ["1003"],
      timeFrame: {
        kind: "range",
        startBizDate: "2026-03-25",
        endBizDate: "2026-03-29",
        label: "近5天",
        days: 5,
      },
      metrics: [
        { key: "pointClockRate", label: "点钟率" },
        { key: "addClockRate", label: "加钟率" },
      ],
    });
  });

  it("parses Chinese full-date daily report asks as a single-day report instead of a month window", () => {
    const query = resolveHetangQueryIntent({
      config,
      text: [
        "我需要一份，下面的日报，",
        "2026年4月11日义乌店经营数据报告",
        "总营业额:32043元",
        "实收营业额:26189元",
      ].join("\n"),
      now: new Date("2026-04-12T10:36:04+08:00"),
    });

    expect(query).toMatchObject({
      kind: "report",
      explicitOrgIds: ["1001"],
      timeFrame: {
        kind: "single",
        bizDate: "2026-04-11",
      },
    });
  });

  it("infers total-clock metric intent from clock-breakdown phrasing", () => {
    const query = resolveHetangQueryIntent({
      config,
      text: "义乌店昨日136个钟，是怎么构成的？",
      now,
    });

    expect(query).toMatchObject({
      kind: "metric",
      explicitOrgIds: ["1001"],
      timeFrame: {
        kind: "single",
        bizDate: "2026-03-29",
      },
      metrics: [{ key: "totalClockCount", label: "总钟数" }],
    });
  });

  it("parses birthday member asks with natural-day windows instead of business-day cutoff windows", () => {
    const tomorrow = resolveHetangQueryIntent({
      config,
      text: "迎宾店明天过生日的高价值会员有哪些",
      now: new Date("2026-04-05T01:00:08+08:00"),
    });
    const week = resolveHetangQueryIntent({
      config,
      text: "华美店本周生日会员唤回名单",
      now: new Date("2026-04-05T10:00:00+08:00"),
    });

    expect(tomorrow).toMatchObject({
      kind: "birthday_members",
      explicitOrgIds: ["1005"],
      timeFrame: {
        kind: "single",
        bizDate: "2026-04-06",
        label: "明天",
      },
    });
    expect(week).toMatchObject({
      kind: "birthday_members",
      explicitOrgIds: ["1003"],
      timeFrame: {
        kind: "range",
        startBizDate: "2026-03-30",
        endBizDate: "2026-04-05",
        label: "本周",
      },
    });
  });

  it("parses wait-experience asks into a dedicated wait analysis intent", () => {
    const avgWait = resolveHetangQueryIntent({
      config,
      text: "迎宾店昨天平均等待时长多少分钟",
      now,
    });
    const byTech = resolveHetangQueryIntent({
      config,
      text: "哪位技师近7天平均候钟时间最高",
      now,
    });

    expect(avgWait).toMatchObject({
      kind: "wait_experience",
      explicitOrgIds: ["1005"],
      timeFrame: {
        kind: "single",
        bizDate: "2026-03-29",
      },
    });
    expect(byTech).toMatchObject({
      kind: "wait_experience",
      explicitOrgIds: [],
      timeFrame: {
        kind: "range",
        startBizDate: "2026-03-23",
        endBizDate: "2026-03-29",
      },
    });
  });

  it("parses longest-wait time-bucket asks as wait-experience intent", () => {
    const query = resolveHetangQueryIntent({
      config,
      text: "迎宾店昨天哪个时段等待最长",
      now,
    });

    expect(query).toMatchObject({
      kind: "wait_experience",
      explicitOrgIds: ["1005"],
      timeFrame: {
        kind: "single",
        bizDate: "2026-03-29",
      },
    });
  });

  it("parses arrival-by-time-slot asks into a dedicated arrival profile intent", () => {
    const query = resolveHetangQueryIntent({
      config,
      text: "统计迎宾店过去一周每天平均各个时段到店的人数，从下午2点到晚上2点。",
      now,
    });

    expect(query).toMatchObject({
      kind: "arrival_profile",
      explicitOrgIds: ["1005"],
      timeFrame: {
        kind: "range",
        startBizDate: "2026-03-23",
        endBizDate: "2026-03-29",
        days: 7,
      },
    });
  });

  it("parses member-marketing and recharge-attribution asks into dedicated intents", () => {
    const sourceRisk = resolveHetangQueryIntent({
      config,
      text: "义乌店哪种来源的会员更容易沉默",
      now,
    });
    const rechargeCardType = resolveHetangQueryIntent({
      config,
      text: "迎宾店近30天哪种卡型充值最好",
      now,
    });

    expect(sourceRisk).toMatchObject({
      kind: "member_marketing",
      explicitOrgIds: ["1001"],
      timeFrame: {
        kind: "single",
        bizDate: "2026-03-29",
      },
    });
    expect(rechargeCardType).toMatchObject({
      kind: "recharge_attribution",
      explicitOrgIds: ["1005"],
      timeFrame: {
        kind: "range",
        startBizDate: "2026-02-28",
        endBizDate: "2026-03-29",
      },
    });
  });

  it("parses customer-service recharge attribution asks into the recharge intent", () => {
    const query = resolveHetangQueryIntent({
      config,
      text: "迎宾店近30天哪个客服带来的充值最多",
      now,
    });

    expect(query).toMatchObject({
      kind: "recharge_attribution",
      explicitOrgIds: ["1005"],
      timeFrame: {
        kind: "range",
        startBizDate: "2026-02-28",
        endBizDate: "2026-03-29",
      },
    });
  });

  it("parses boss-style customer follow-up questions with an explicit month window", () => {
    const query = resolveHetangQueryIntent({
      config,
      text: "华美店3月份最值得跟进的顾客有哪些",
      now: new Date("2026-04-04T09:00:00+08:00"),
    });

    expect(query).toMatchObject({
      kind: "customer_segment",
      explicitOrgIds: ["1003"],
      timeFrame: {
        kind: "range",
        startBizDate: "2026-03-01",
        endBizDate: "2026-03-31",
        label: "3月份",
      },
    });
  });

  it("normalizes boss-style store health phrasing into a report intent", () => {
    const query = resolveHetangQueryIntent({
      config,
      text: "义乌店近7天盘子稳不稳",
      now,
    });

    expect(query).toMatchObject({
      kind: "report",
      explicitOrgIds: ["1001"],
      timeFrame: {
        kind: "range",
        startBizDate: "2026-03-23",
        endBizDate: "2026-03-29",
      },
    });
  });

  it("parses natural-language cash-in phrasing into service revenue", () => {
    const query = resolveHetangQueryIntent({
      config,
      text: "义乌店今天进账多少",
      now,
    });

    expect(query).toMatchObject({
      kind: "metric",
      explicitOrgIds: ["1001"],
      timeFrame: {
        kind: "single",
        bizDate: "2026-03-30",
      },
      metrics: [{ key: "serviceRevenue", label: "服务营收" }],
    });
  });

  it("parses natural-language recharge inflow phrasing into recharge cash", () => {
    const query = resolveHetangQueryIntent({
      config,
      text: "迎宾店本月充了多少钱进来",
      now,
    });

    expect(query).toMatchObject({
      kind: "metric",
      explicitOrgIds: ["1005"],
      timeFrame: {
        kind: "range",
        startBizDate: "2026-03-01",
        endBizDate: "2026-03-29",
        label: "本月",
      },
      metrics: [{ key: "rechargeCash", label: "充值现金" }],
    });
  });

  it("parses natural-language churn-risk member asks into customer follow-up intent", () => {
    const query = resolveHetangQueryIntent({
      config,
      text: "迎宾店哪些会员快跑了",
      now,
    });

    expect(query).toMatchObject({
      kind: "customer_segment",
      explicitOrgIds: ["1005"],
      semanticSlots: {
        object: "customer",
        action: "followup",
      },
    });
  });

  it("parses natural-language groupbuy revisit asks into the revisit metric", () => {
    const query = resolveHetangQueryIntent({
      config,
      text: "义乌店近30天美团来的客人回头了吗",
      now,
    });

    expect(query).toMatchObject({
      kind: "metric",
      explicitOrgIds: ["1001"],
      metrics: [{ key: "groupbuy7dRevisitRate", label: "7天复到店率" }],
    });
  });

  it("parses natural-language new-customer asks into new member count", () => {
    const query = resolveHetangQueryIntent({
      config,
      text: "义乌店今天来了几个新客",
      now,
    });

    expect(query).toMatchObject({
      kind: "metric",
      explicitOrgIds: ["1001"],
      timeFrame: {
        kind: "single",
        bizDate: "2026-03-30",
      },
      metrics: [{ key: "newMembers", label: "新增会员" }],
    });
  });

  it("normalizes groupbuy handoff slang into the underlying conversion metrics", () => {
    const query = resolveHetangQueryIntent({
      config,
      text: "华美店团购客接没接住",
      now,
    });

    expect(query).toMatchObject({
      kind: "metric",
      explicitOrgIds: ["1003"],
      metrics: [
        { key: "groupbuy7dRevisitRate", label: "7天复到店率" },
        { key: "groupbuy7dStoredValueConversionRate", label: "7天储值转化率" },
        { key: "groupbuyFirstOrderHighValueMemberRate", label: "团购首单客转高价值会员率" },
      ],
    });
  });

  it("normalizes newer operator slang into stable business intents", () => {
    const storeHealth = resolveHetangQueryIntent({
      config,
      text: "迎宾店盘子有没有问题",
      now,
    });
    const focusTradeoff = resolveHetangQueryIntent({
      config,
      text: "迎宾店最近该先抓复购还是储值",
      now,
    });
    const shiftCatch = resolveHetangQueryIntent({
      config,
      text: "迎宾店昨天哪个班次没接住",
      now,
    });

    expect(storeHealth).toMatchObject({
      kind: "risk",
      explicitOrgIds: ["1005"],
    });
    expect(focusTradeoff).toMatchObject({
      kind: "advice",
      explicitOrgIds: ["1005"],
    });
    expect(shiftCatch).toMatchObject({
      kind: "wait_experience",
      explicitOrgIds: ["1005"],
      timeFrame: {
        kind: "single",
        bizDate: "2026-03-29",
      },
    });
  });

  it("parses rise-or-fall trend phrasing into a trend intent with the right metric", () => {
    const revenueTrend = resolveHetangQueryIntent({
      config,
      text: "义乌店近30天营收是涨还是掉",
      now,
    });
    const rechargeTrend = resolveHetangQueryIntent({
      config,
      text: "义乌店近30天储值是涨还是掉",
      now,
    });

    expect(revenueTrend).toMatchObject({
      kind: "trend",
      explicitOrgIds: ["1001"],
      timeFrame: {
        kind: "range",
        startBizDate: "2026-02-28",
        endBizDate: "2026-03-29",
        label: "近30天",
      },
      metrics: [{ key: "serviceRevenue", label: "服务营收" }],
    });
    expect(rechargeTrend).toMatchObject({
      kind: "trend",
      explicitOrgIds: ["1001"],
      timeFrame: {
        kind: "range",
        startBizDate: "2026-02-28",
        endBizDate: "2026-03-29",
        label: "近30天",
      },
      metrics: [{ key: "rechargeStoredValue", label: "充值总额（含赠送）" }],
    });
  });

  it("parses open danger-zone phrasing into a risk intent instead of guidance", () => {
    const query = resolveHetangQueryIntent({
      config,
      text: "义乌店近30天哪里最危险",
      now,
    });

    expect(query).toMatchObject({
      kind: "risk",
      explicitOrgIds: ["1001"],
      timeFrame: {
        kind: "range",
        startBizDate: "2026-02-28",
        endBizDate: "2026-03-29",
        label: "近30天",
      },
    });
  });

  it("parses follow-up candidate asks phrased as past-30-day top customers to follow up", () => {
    const query = resolveHetangQueryIntent({
      config,
      text: "迎宾店 过去30天 哪10个顾客 最需要跟进",
      now: new Date("2026-04-05T01:00:08+08:00"),
    });

    expect(query).toMatchObject({
      kind: "customer_segment",
      explicitOrgIds: ["1005"],
      timeFrame: {
        kind: "range",
        startBizDate: "2026-03-05",
        endBizDate: "2026-04-03",
        label: "过去30天",
      },
    });
  });

  it("parses store-manager aliases used in follow-up outputs back into customer segment asks", () => {
    const highValueReactivation = resolveHetangQueryIntent({
      config,
      text: "迎宾店高价值待唤回名单",
      now,
    });
    const potentialGrowth = resolveHetangQueryIntent({
      config,
      text: "迎宾店潜力成长名单",
      now,
    });
    const silentMembers = resolveHetangQueryIntent({
      config,
      text: "迎宾店沉默会员名单",
      now,
    });

    expect(highValueReactivation).toMatchObject({
      kind: "customer_segment",
      explicitOrgIds: ["1005"],
    });
    expect(potentialGrowth).toMatchObject({
      kind: "customer_segment",
      explicitOrgIds: ["1005"],
    });
    expect(silentMembers).toMatchObject({
      kind: "customer_segment",
      explicitOrgIds: ["1005"],
    });
  });

  it("parses recall-style boss wording into customer follow-up intent", () => {
    const recallAsk = resolveHetangQueryIntent({
      config,
      text: "义乌店最值得召回的顾客是哪个",
      now,
    });
    const reactivateAsk = resolveHetangQueryIntent({
      config,
      text: "义乌店最值得唤回的顾客是哪个",
      now,
    });

    expect(recallAsk).toMatchObject({
      kind: "customer_segment",
      explicitOrgIds: ["1001"],
      semanticSlots: {
        object: "customer",
        action: "followup",
      },
    });
    expect(reactivateAsk).toMatchObject({
      kind: "customer_segment",
      explicitOrgIds: ["1001"],
      semanticSlots: {
        object: "customer",
        action: "followup",
      },
    });
  });

  it("parses generic payment-structure phrasing into the payment share metric set", () => {
    const query = resolveHetangQueryIntent({
      config,
      text: "义乌店昨日各种消费方式占比逐个列一下",
      now,
    });

    expect(query).toMatchObject({
      kind: "metric",
      explicitOrgIds: ["1001"],
      timeFrame: {
        kind: "single",
        bizDate: "2026-03-29",
      },
    });
    expect(query?.metrics).toEqual(
      expect.arrayContaining([
        { key: "memberPaymentShare", label: "会员消费占比" },
        { key: "cashPaymentShare", label: "现金消费占比" },
        { key: "wechatPaymentShare", label: "微信支付占比" },
        { key: "alipayPaymentShare", label: "支付宝支付占比" },
        { key: "groupbuyAmountShare", label: "团购消费占比" },
      ]),
    );
  });

  it("parses grouped payment-amount and groupbuy-platform phrasing", () => {
    const paymentAmounts = resolveHetangQueryIntent({
      config,
      text: "义乌店昨天微信和现金分别多少",
      now,
    });
    const platformAmounts = resolveHetangQueryIntent({
      config,
      text: "义乌店昨天美团和抖音分别多少",
      now,
    });
    const platformShares = resolveHetangQueryIntent({
      config,
      text: "义乌店昨天团购平台占比分布",
      now,
    });

    expect(paymentAmounts?.metrics).toEqual(
      expect.arrayContaining([
        { key: "wechatPaymentAmount", label: "微信支付金额" },
        { key: "cashPaymentAmount", label: "现金支付金额" },
      ]),
    );
    expect(platformAmounts?.metrics).toEqual(
      expect.arrayContaining([
        { key: "meituanGroupbuyAmount", label: "美团团购金额" },
        { key: "douyinGroupbuyAmount", label: "抖音团购金额" },
      ]),
    );
    expect(platformShares?.metrics).toEqual(
      expect.arrayContaining([
        { key: "meituanGroupbuyAmountShare", label: "美团团购金额占比" },
        { key: "douyinGroupbuyAmountShare", label: "抖音团购金额占比" },
      ]),
    );
  });

  it("parses customer-segment and customer-tech relationship questions", () => {
    const segmentCount = resolveHetangQueryIntent({
      config,
      text: "义乌店重要价值会员有多少",
      now,
    });
    const segmentList = resolveHetangQueryIntent({
      config,
      text: "义乌店沉睡会员名单",
      now,
    });
    const customerRelation = resolveHetangQueryIntent({
      config,
      text: "王先生最近30天被哪些技师服务过",
      now,
    });
    const techRelation = resolveHetangQueryIntent({
      config,
      text: "杜莎最近30天服务了哪些高价值会员",
      now,
    });

    expect(segmentCount).toMatchObject({
      kind: "customer_segment",
      explicitOrgIds: ["1001"],
      timeFrame: {
        kind: "single",
        bizDate: "2026-03-29",
      },
    });
    expect(segmentList).toMatchObject({
      kind: "customer_segment",
      explicitOrgIds: ["1001"],
    });
    expect(customerRelation).toMatchObject({
      kind: "customer_relation",
      explicitOrgIds: [],
      timeFrame: {
        kind: "range",
        startBizDate: "2026-02-28",
        endBizDate: "2026-03-29",
      },
    });
    expect(techRelation).toMatchObject({
      kind: "customer_relation",
      explicitOrgIds: [],
      timeFrame: {
        kind: "range",
        startBizDate: "2026-02-28",
        endBizDate: "2026-03-29",
      },
    });
  });

  it("parses natural-language tech earnings and efficiency ranking asks", () => {
    const topEarningTech = resolveHetangQueryIntent({
      config,
      text: "义乌店哪个技师最能赚",
      now,
    });
    const highestEfficiencyTech = resolveHetangQueryIntent({
      config,
      text: "义乌店人效最高的技师是谁",
      now,
    });

    expect(topEarningTech).toMatchObject({
      kind: "ranking",
      rankingTarget: "tech",
      explicitOrgIds: ["1001"],
      metrics: [{ key: "serviceRevenue", label: "服务营收" }],
    });
    expect(highestEfficiencyTech).toMatchObject({
      kind: "ranking",
      rankingTarget: "tech",
      explicitOrgIds: ["1001"],
      metrics: [{ key: "clockEffect", label: "钟效" }],
    });
  });

  it("keeps tech-binding customer ranking asks on the customer follow-up route", () => {
    const query = resolveHetangQueryIntent({
      config,
      text: "义乌店哪个技师绑定的高价值会员最多",
      now,
    });

    expect(query).toMatchObject({
      kind: "customer_segment",
      explicitOrgIds: ["1001"],
    });
  });

  it("parses recharge-without-visit member asks into the customer-segment intent", () => {
    const query = resolveHetangQueryIntent({
      config,
      text: "迎宾店谁充了钱还没来过",
      now,
    });

    expect(query).toMatchObject({
      kind: "customer_segment",
      explicitOrgIds: ["1005"],
      timeFrame: {
        kind: "single",
        bizDate: "2026-03-29",
      },
    });
  });

  it("parses coupon-usage asks into the member-marketing intent", () => {
    const query = resolveHetangQueryIntent({
      config,
      text: "迎宾店上次发的券有多少人用了",
      now,
    });

    expect(query).toMatchObject({
      kind: "member_marketing",
      explicitOrgIds: ["1005"],
      timeFrame: {
        kind: "single",
        bizDate: "2026-03-29",
      },
    });
  });

  it("parses add-on sales phrasing into a market revenue metric ask", () => {
    const query = resolveHetangQueryIntent({
      config,
      text: "义乌店昨天副项卖了多少钱",
      now,
    });

    expect(query).toMatchObject({
      kind: "metric",
      explicitOrgIds: ["1001"],
      metrics: [{ key: "marketRevenue", label: "推销营收" }],
    });
  });

  it("parses add-on item-breakdown phrasing into a market revenue metric ask", () => {
    const query = resolveHetangQueryIntent({
      config,
      text: "义乌店今天卖出什么副项了",
      now,
    });

    expect(query).toMatchObject({
      kind: "metric",
      explicitOrgIds: ["1001"],
    });
    expect(query?.metrics).toEqual(
      expect.arrayContaining([{ key: "marketRevenue", label: "推销营收" }]),
    );
  });

  it("parses add-on sales ranking phrasing into a tech ranking ask", () => {
    const query = resolveHetangQueryIntent({
      config,
      text: "义乌店今天谁推销做得好",
      now,
    });

    expect(query).not.toBeNull();
    if (!query) {
      throw new Error("expected query intent");
    }
    expect(query).toMatchObject({
      kind: "ranking",
      rankingTarget: "tech",
      explicitOrgIds: ["1001"],
    });
    expect(query.metrics).toEqual(
      expect.arrayContaining([{ key: "marketRevenue", label: "推销营收" }]),
    );
  });

  it("parses realtime tech-current asks into the tech_current intent", () => {
    const onClock = resolveHetangQueryIntent({
      config,
      text: "现在几个人在上钟",
      now,
    });
    const idleList = resolveHetangQueryIntent({
      config,
      text: "义乌店哪些技师现在有空",
      now,
    });

    expect(onClock).toMatchObject({
      kind: "tech_current",
      explicitOrgIds: [],
      timeFrame: {
        kind: "single",
        bizDate: "2026-03-29",
      },
    });
    expect(idleList).toMatchObject({
      kind: "tech_current",
      explicitOrgIds: ["1001"],
    });
  });

  it("parses phone-suffix customer profile questions", () => {
    const profile = resolveHetangQueryIntent({
      config,
      text: "义乌店尾号7500客户画像",
      now,
    });
    const techPreference = resolveHetangQueryIntent({
      config,
      text: "尾号7500最近喜欢哪个技师",
      now,
    });
    const addOnPreference = resolveHetangQueryIntent({
      config,
      text: "义乌店手机号后四位7500常买什么茶饮",
      now,
    });

    expect(profile).toMatchObject({
      kind: "customer_profile",
      explicitOrgIds: ["1001"],
      phoneSuffix: "7500",
      timeFrame: {
        kind: "range",
        startBizDate: "2025-12-30",
        endBizDate: "2026-03-29",
        days: 90,
      },
    });
    expect(techPreference).toMatchObject({
      kind: "customer_profile",
      explicitOrgIds: [],
      phoneSuffix: "7500",
    });
    expect(addOnPreference).toMatchObject({
      kind: "customer_profile",
      explicitOrgIds: ["1001"],
      phoneSuffix: "7500",
    });
  });

  it.each([
    ["这周五个店整体怎么样", { allStoresRequested: true }],
    ["哪家在拉升，哪家最危险", {}],
    ["下周总部先抓什么", {}],
    ["五店整体表现", { allStoresRequested: true }],
    ["各店整体情况，总部重点关注哪家", { allStoresRequested: true }],
    ["哪个门店须重点关注", { allStoresRequested: true }],
  ])("parses HQ portfolio questions: %s", (text, extra) => {
    const query = resolveHetangQueryIntent({ config, text, now });

    expect(query).toMatchObject({
      kind: "hq_portfolio",
      timeFrame: {
        kind: "range",
        days: 15,
      },
      ...extra,
    });
  });

  it("parses colloquial five-store window health asks into an HQ portfolio intent", () => {
    const query = resolveHetangQueryIntent({
      config,
      text: "这几天五店怎么样",
      now,
    });

    expect(query).toMatchObject({
      kind: "hq_portfolio",
      allStoresRequested: true,
      timeFrame: {
        kind: "range",
        days: 5,
        label: "近5天",
      },
    });
  });

  it("parses colloquial five-store window focus asks into an HQ portfolio intent", () => {
    const query = resolveHetangQueryIntent({
      config,
      text: "五店近7天重点看什么",
      now,
    });

    expect(query).toMatchObject({
      kind: "hq_portfolio",
      allStoresRequested: true,
      timeFrame: {
        kind: "range",
        days: 7,
        label: "近7天",
      },
    });
  });

  it("parses HQ portfolio with explicit time frame", () => {
    const query = resolveHetangQueryIntent({
      config,
      text: "近14天五店整体怎么样",
      now,
    });

    expect(query).toMatchObject({
      kind: "hq_portfolio",
      allStoresRequested: true,
      timeFrame: {
        kind: "range",
        days: 14,
      },
    });
  });

  it("treats Arabic all-store phrasing like 5个店 as an all-stores ask", () => {
    const query = resolveHetangQueryIntent({
      config,
      text: "5个店近一周的营收情况",
      now,
    });

    expect(query).toMatchObject({
      kind: "metric",
      allStoresRequested: true,
      timeFrame: {
        kind: "range",
        days: 7,
        label: "近7天",
      },
      metrics: [{ key: "serviceRevenue", label: "服务营收" }],
    });
  });

  it("parses broad HQ boss phrasing like 近30天五店盘子稳不稳 into portfolio review", () => {
    const query = resolveHetangQueryIntent({
      config,
      text: "近30天五店盘子稳不稳，哪家店最近最危险",
      now,
    });

    expect(query).toMatchObject({
      kind: "hq_portfolio",
      allStoresRequested: true,
      timeFrame: {
        kind: "range",
        days: 30,
      },
    });
  });

  it("parses single-store window health asks into a report intent", () => {
    const query = resolveHetangQueryIntent({
      config,
      text: "这几天义乌店怎么样",
      now,
    });

    expect(query).toMatchObject({
      kind: "report",
      explicitOrgIds: ["1001"],
      allStoresRequested: false,
      timeFrame: {
        kind: "range",
        days: 5,
        label: "近5天",
      },
    });
  });

  it("parses single-store window focus asks into an advice intent", () => {
    const query = resolveHetangQueryIntent({
      config,
      text: "义乌店近7天重点看什么",
      now,
    });

    expect(query).toMatchObject({
      kind: "advice",
      explicitOrgIds: ["1001"],
      allStoresRequested: false,
      timeFrame: {
        kind: "range",
        days: 7,
        label: "近7天",
      },
    });
  });

  it.each([
    ["义乌店近30天营收走弱了吗", "serviceRevenue"],
    ["义乌店近30天客流回落了吗", "customerCount"],
    ["义乌店近30天钟效下滑了吗", "clockEffect"],
  ])("parses softening trend phrasing into a trend intent with the right metric: %s", (text, metricKey) => {
    const query = resolveHetangQueryIntent({
      config,
      text,
      now,
    });

    expect(query).toMatchObject({
      kind: "trend",
      explicitOrgIds: ["1001"],
      timeFrame: {
        kind: "range",
        days: 30,
      },
    });
    expect(query?.metrics[0]?.key).toBe(metricKey);
  });

  it.each([
    ["义乌店近30天营收回暖了吗", "serviceRevenue"],
    ["义乌店近30天客流走高了吗", "customerCount"],
    ["义乌店近30天钟效拉升了吗", "clockEffect"],
  ])("parses strengthening trend phrasing into a trend intent with the right metric: %s", (text, metricKey) => {
    const query = resolveHetangQueryIntent({
      config,
      text,
      now,
    });

    expect(query).toMatchObject({
      kind: "trend",
      explicitOrgIds: ["1001"],
      timeFrame: {
        kind: "range",
        days: 30,
      },
    });
    expect(query?.metrics[0]?.key).toBe(metricKey);
  });

  it.each([
    ["义乌店近7天营收和前7天比是好还是差", "serviceRevenue"],
    ["义乌店近7天客流和前7天比强不强", "customerCount"],
    ["义乌店近7天钟效跟前7天比有没有好点", "clockEffect"],
  ])(
    "parses colloquial previous-window compare phrasing into a compare intent with the right metric: %s",
    (text, metricKey) => {
      const query = resolveHetangQueryIntent({
        config,
        text,
        now,
      });

      expect(query).toMatchObject({
        kind: "compare",
        explicitOrgIds: ["1001"],
        timeFrame: {
          kind: "range",
          days: 7,
        },
        comparisonTimeFrame: {
          kind: "range",
          days: 7,
        },
      });
      expect(query?.metrics[0]?.key).toBe(metricKey);
    },
  );

  it("parses colloquial store light-diagnosis phrasing into an anomaly intent", () => {
    const query = resolveHetangQueryIntent({
      config,
      text: "义乌店近30天盘子哪里不对",
      now,
    });

    expect(query).toMatchObject({
      kind: "anomaly",
      explicitOrgIds: ["1001"],
      timeFrame: {
        kind: "range",
        days: 30,
      },
    });
  });

  it("parses colloquial HQ light-diagnosis phrasing into a portfolio intent", () => {
    const query = resolveHetangQueryIntent({
      config,
      text: "五店近30天整体哪里不对",
      now,
    });

    expect(query).toMatchObject({
      kind: "hq_portfolio",
      allStoresRequested: true,
      timeFrame: {
        kind: "range",
        days: 30,
      },
    });
  });

  it("parses five-store deep review phrasing into HQ portfolio intent", () => {
    const query = resolveHetangQueryIntent({
      config,
      text: "五店近7天经营复盘",
      now,
    });

    expect(query).not.toBeNull();

    expect(query).toMatchObject({
      kind: "hq_portfolio",
      allStoresRequested: true,
      timeFrame: {
        kind: "range",
        days: 7,
      },
    });
  });

  it("parses technician profile questions before falling back to generic metric queries", () => {
    const profile = resolveHetangQueryIntent({
      config,
      text: "义乌店 技师 白慧慧 的画像",
      now,
    });

    expect(profile).toMatchObject({
      kind: "tech_profile",
      explicitOrgIds: ["1001"],
      timeFrame: {
        kind: "range",
        startBizDate: "2026-02-28",
        endBizDate: "2026-03-29",
        days: 30,
      },
    });
  });

  it("attaches typed semantic slots onto resolved intents", () => {
    const query = resolveHetangQueryIntent({
      config,
      text: "义乌店近30天最值得先跟进的会员名单",
      now,
    });

    if (!query) {
      throw new Error("expected query intent");
    }
    expect(query.semanticSlots).toMatchObject({
      store: {
        scope: "single",
        orgIds: ["1001"],
      },
      object: "customer",
      action: "followup",
      metricKeys: [],
      time: {
        kind: "range",
        startBizDate: "2026-02-28",
        endBizDate: "2026-03-29",
      },
    });
  });
});
