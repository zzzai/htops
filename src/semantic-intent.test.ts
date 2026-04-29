import { describe, expect, it } from "vitest";
import { resolveHetangOpsConfig } from "./config.js";
import { resolveSemanticIntent } from "./semantic-intent.js";
import type { HetangConversationSemanticStateSnapshot } from "./types.js";

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
        rawAliases: ["义乌"],
        notification: { channel: "wecom", target: "room-yiwu" },
      },
      {
        orgId: "1002",
        storeName: "迎宾店",
        rawAliases: ["迎宾"],
        notification: { channel: "wecom", target: "room-yingbin" },
      },
    ],
    sync: { enabled: false },
    reporting: { enabled: false },
  });
}

describe("resolveSemanticIntent", () => {
  const config = buildConfig();
  const now = new Date("2026-04-13T10:00:00+08:00");
  const pendingClarifyState: HetangConversationSemanticStateSnapshot = {
    sessionId: "wecom:conv-1",
    channel: "wecom",
    senderId: "user-1",
    conversationId: "conv-1",
    clarificationPending: true,
    clarificationReason: "missing-time",
    anchoredSlots: {},
    missingSlots: ["time"],
    beliefState: {
      pendingText: "义乌店营收怎么样",
    },
    desireState: {},
    intentionState: {},
    updatedAt: "2026-04-13T10:00:00+08:00",
    expiresAt: "2026-04-13T11:00:00+08:00",
  };

  it("routes concept and method asks into the meta lane", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "什么是复盘，如何复盘？",
      now,
    });

    expect(intent).toMatchObject({
      lane: "meta",
      kind: "concept_explain",
      action: "explain",
      clarificationNeeded: false,
    });
  });

  it("routes direct metric asks into the query lane", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "义乌店昨天营收多少",
      now,
    });

    expect(intent).toMatchObject({
      lane: "query",
      kind: "query",
      object: "store",
      action: "summary",
      clarificationNeeded: false,
      capabilityId: "store_day_summary_v1",
    });
    expect(intent.scope.orgIds).toEqual(["1001"]);
  });

  it("routes natural-language cash-in phrasing into the query lane", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "义乌店今天进账多少",
      now,
    });

    expect(intent).toMatchObject({
      lane: "query",
      kind: "query",
      object: "store",
      action: "summary",
      clarificationNeeded: false,
      capabilityId: "store_day_summary_v1",
    });
    expect(intent.scope.orgIds).toEqual(["1001"]);
  });

  it("routes natural-language churn-risk member asks into the customer follow-up lane", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "迎宾店哪些会员快跑了",
      now,
    });

    expect(intent).toMatchObject({
      lane: "query",
      kind: "query",
      object: "customer",
      clarificationNeeded: false,
    });
    expect(intent.scope.orgIds).toEqual(["1002"]);
  });

  it("routes store-scoped window focus asks onto the advice lane instead of metric clarification", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "义乌店近7天重点看什么",
      now,
    });

    expect(intent).toMatchObject({
      lane: "query",
      kind: "query",
      object: "store",
      action: "advice",
      clarificationNeeded: false,
      capabilityId: "store_advice_v1",
      timeFrameLabel: "近7天",
    });
    expect(intent.scope.orgIds).toEqual(["1001"]);
  });

  it("uses the bound single-store scope when the user omits the store name", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "昨天营收多少",
      now,
      binding: {
        channel: "wecom",
        senderId: "user-1",
        employeeName: "迎宾店店长",
        role: "manager",
        orgId: "1002",
        scopeOrgIds: ["1002"],
        isActive: true,
      },
      defaultOrgId: "1002",
    });

    expect(intent).toMatchObject({
      lane: "query",
      kind: "query",
      object: "store",
      action: "summary",
      clarificationNeeded: false,
      capabilityId: "store_day_summary_v1",
    });
    expect(intent.scope.orgIds).toEqual(["1002"]);
  });

  it("maps clock-breakdown asks onto the serving breakdown capability", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "义乌店昨日136个钟，是怎么构成的？",
      now,
    });

    expect(intent).toMatchObject({
      lane: "query",
      kind: "query",
      capabilityId: "store_day_clock_breakdown_v1",
      clarificationNeeded: false,
    });
  });

  it("resolves a carried missing-metric supplement into a concrete query on the main semantic path", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "就看卡里还有多少",
      now,
      semanticState: {
        sessionId: "wecom:conv-1",
        channel: "wecom",
        senderId: "user-1",
        conversationId: "conv-1",
        clarificationPending: true,
        clarificationReason: "missing-metric",
        anchoredSlots: {},
        missingSlots: ["metric"],
        beliefState: {
          pendingText: "义乌店近7天重点看什么",
        },
        desireState: {},
        intentionState: {},
        updatedAt: "2026-04-13T10:00:00+08:00",
        expiresAt: "2026-04-13T11:00:00+08:00",
      },
    });

    expect(intent).toMatchObject({
      lane: "query",
      kind: "query",
      object: "store",
      action: "advice",
      capabilityId: "store_advice_v1",
      clarificationNeeded: false,
      timeFrameLabel: "近7天",
    });
  });

  it("maps customer profile asks onto the customer profile lookup capability", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "义乌店近30天尾号3456的顾客画像",
      now,
    });

    expect(intent).toMatchObject({
      lane: "query",
      kind: "query",
      object: "customer",
      capabilityId: "customer_profile_lookup_v1",
      action: "profile",
      clarificationNeeded: false,
    });
    expect(intent.scope.orgIds).toEqual(["1001"]);
  });

  it("maps birthday-member asks onto the birthday list capability", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "迎宾店明天过生日的高价值会员有哪些",
      now,
    });

    expect(intent).toMatchObject({
      lane: "query",
      kind: "query",
      object: "customer",
      capabilityId: "birthday_member_list_v1",
      action: "list",
      clarificationNeeded: false,
    });
    expect(intent.scope.orgIds).toEqual(["1002"]);
  });

  it("maps wait-experience asks onto the wait analysis capability", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "迎宾店昨天哪个时段等待最长",
      now,
    });

    expect(intent).toMatchObject({
      lane: "query",
      kind: "query",
      capabilityId: "wait_experience_analysis_v1",
      action: "anomaly",
      clarificationNeeded: false,
    });
  });

  it("maps arrival-profile asks onto the arrival profile capability", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "统计迎宾店过去一周每天平均各个时段到店的人数，从下午2点到晚上2点。",
      now,
    });

    expect(intent).toMatchObject({
      lane: "query",
      kind: "query",
      capabilityId: "arrival_profile_timeseries_v1",
      action: "trend",
      clarificationNeeded: false,
    });
  });

  it("maps member-marketing asks onto the member marketing capability", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "义乌店哪种来源的会员更容易沉默",
      now,
    });

    expect(intent).toMatchObject({
      lane: "query",
      kind: "query",
      object: "customer",
      capabilityId: "member_marketing_analysis_v1",
      action: "ranking",
      clarificationNeeded: false,
    });
  });

  it("maps coupon-usage asks onto the member marketing capability", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "迎宾店上次发的券有多少人用了",
      now,
    });

    expect(intent).toMatchObject({
      lane: "query",
      kind: "query",
      object: "customer",
      capabilityId: "member_marketing_analysis_v1",
      action: "ranking",
      clarificationNeeded: false,
    });
    expect(intent.scope.orgIds).toEqual(["1002"]);
  });

  it("routes add-on revenue asks onto the store metric capability", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "义乌店昨天副项卖了多少钱",
      now,
    });

    expect(intent).toMatchObject({
      lane: "query",
      kind: "query",
      object: "store",
      capabilityId: "store_metric_summary_v1",
      action: "summary",
      clarificationNeeded: false,
    });
    expect(intent.scope.orgIds).toEqual(["1001"]);
  });

  it("routes add-on sales ranking asks onto the tech ranking capability", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "义乌店今天谁推销做得好",
      now,
    });

    expect(intent).toMatchObject({
      lane: "query",
      kind: "query",
      object: "tech",
      capabilityId: "tech_leaderboard_ranking_v1",
      action: "ranking",
      clarificationNeeded: false,
    });
    expect(intent.scope.orgIds).toEqual(["1001"]);
  });

  it("routes add-on item-breakdown asks onto the dedicated market breakdown capability", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "义乌店今天卖出什么副项了",
      now,
    });

    expect(intent).toMatchObject({
      lane: "query",
      kind: "query",
      object: "store",
      capabilityId: "store_market_breakdown_v1",
      action: "breakdown",
      clarificationNeeded: false,
    });
    expect(intent.scope.orgIds).toEqual(["1001"]);
  });

  it("routes realtime tech-current asks onto the dedicated current-state capability", () => {
    const onClock = resolveSemanticIntent({
      config,
      text: "现在几个人在上钟",
      now,
      binding: {
        channel: "wecom",
        senderId: "manager-yiwu",
        employeeName: "义乌店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1001"],
      },
    });
    const idleList = resolveSemanticIntent({
      config,
      text: "义乌店哪些技师现在有空",
      now,
    });

    expect(onClock).toMatchObject({
      lane: "query",
      kind: "query",
      object: "tech",
      capabilityId: "tech_current_runtime_v1",
      action: "summary",
      clarificationNeeded: false,
    });
    expect(onClock.scope.orgIds).toEqual(["1001"]);
    expect(idleList).toMatchObject({
      lane: "query",
      kind: "query",
      object: "tech",
      capabilityId: "tech_current_runtime_v1",
      action: "list",
      clarificationNeeded: false,
    });
  });

  it("maps recharge-attribution asks onto the recharge attribution capability", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "迎宾店近30天哪种卡型充值最好",
      now,
    });

    expect(intent).toMatchObject({
      lane: "query",
      kind: "query",
      capabilityId: "recharge_attribution_analysis_v1",
      action: "ranking",
      clarificationNeeded: false,
    });
  });

  it("maps tech-profile asks onto the tech profile capability", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "义乌店 技师 白慧慧 的画像",
      now,
    });

    expect(intent).toMatchObject({
      lane: "query",
      kind: "query",
      object: "tech",
      capabilityId: "tech_profile_lookup_v1",
      action: "profile",
      clarificationNeeded: false,
    });
  });

  it("routes deep diagnosis asks into the analysis lane", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "义乌店近30天为什么承压，给我做个深度复盘",
      now,
    });

    expect(intent).toMatchObject({
      lane: "analysis",
      kind: "analysis",
      object: "store",
      action: "analysis",
      clarificationNeeded: false,
    });
    expect(intent.scope.orgIds).toEqual(["1001"]);
  });

  it("routes natural-language tech earnings and efficiency ranking asks onto the tech ranking capability", () => {
    const topEarningTech = resolveSemanticIntent({
      config,
      text: "义乌店哪个技师最能赚",
      now,
    });
    const highestEfficiencyTech = resolveSemanticIntent({
      config,
      text: "义乌店人效最高的技师是谁",
      now,
    });

    expect(topEarningTech).toMatchObject({
      lane: "query",
      kind: "query",
      object: "tech",
      action: "ranking",
      capabilityId: "tech_leaderboard_ranking_v1",
      clarificationNeeded: false,
    });
    expect(highestEfficiencyTech).toMatchObject({
      lane: "query",
      kind: "query",
      object: "tech",
      action: "ranking",
      capabilityId: "tech_leaderboard_ranking_v1",
      clarificationNeeded: false,
    });
  });

  it("classifies unsupported customer-satisfaction asks into a specific meta intent", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "义乌店近30天顾客满意度怎么样",
      now,
    });

    expect(intent).toMatchObject({
      lane: "meta",
      kind: "unsupported_customer_satisfaction",
      object: "customer",
      action: "clarify",
      clarificationNeeded: false,
    });
  });

  it("classifies realtime queue and pending-settlement asks into specific meta intents", () => {
    const queueIntent = resolveSemanticIntent({
      config,
      text: "义乌店现在有客人在等位吗",
      now,
    });
    const settlementIntent = resolveSemanticIntent({
      config,
      text: "义乌店后台有几张待结账的单",
      now,
    });

    expect(queueIntent).toMatchObject({
      lane: "meta",
      kind: "unsupported_realtime_queue",
      object: "store",
      action: "clarify",
      clarificationNeeded: false,
    });
    expect(settlementIntent).toMatchObject({
      lane: "meta",
      kind: "unsupported_pending_settlement",
      object: "store",
      action: "clarify",
      clarificationNeeded: false,
    });
  });

  it("classifies mixed HQ and single-store asks into a specific clarify intent", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "哪家店最危险，迎宾店具体哪里有问题",
      now,
    });

    expect(intent).toMatchObject({
      lane: "meta",
      kind: "clarify_mixed_scope",
      action: "clarify",
      clarificationNeeded: true,
    });
  });

  it("classifies missing-time store asks into a specific clarify intent", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "义乌店营收怎么样",
      now,
    });

    expect(intent).toMatchObject({
      lane: "meta",
      kind: "clarify_missing_time",
      action: "clarify",
      clarificationNeeded: true,
    });
  });

  it("inherits a pending clarify state when the next turn only provides the missing time range", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "近7天",
      now,
      semanticState: pendingClarifyState,
    });

    expect(intent).toMatchObject({
      lane: "query",
      kind: "query",
      object: "store",
      action: "report",
      clarificationNeeded: false,
      capabilityId: "store_report_v1",
    });
    expect(intent.scope.orgIds).toEqual(["1001"]);
    expect(intent.timeFrameLabel).toBe("近7天");
  });

  it("classifies strategy-open asks into a fine-grained business guidance intent", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "义乌店接下来怎么抓",
      now,
    });

    expect(intent).toMatchObject({
      lane: "meta",
      kind: "guidance_strategy_open_question",
      object: "store",
      action: "clarify",
      clarificationNeeded: false,
    });
  });

  it("classifies customer-operation asks without a store into a fine-grained guidance intent", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "最近该召回哪些顾客",
      now,
    });

    expect(intent).toMatchObject({
      lane: "meta",
      kind: "guidance_customer_missing_store",
      object: "customer",
      action: "clarify",
      clarificationNeeded: false,
    });
  });

  it("classifies business asks missing a time range into a fine-grained guidance intent", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "义乌店顾客跟进重点",
      now,
    });

    expect(intent).toMatchObject({
      lane: "meta",
      kind: "guidance_customer_missing_time_range",
      object: "customer",
      action: "clarify",
      clarificationNeeded: false,
    });
  });

  it("classifies store-and-time asks missing a metric into a fine-grained guidance intent", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "义乌店昨天怎么样",
      now,
    });

    expect(intent).toMatchObject({
      lane: "meta",
      kind: "guidance_store_missing_metric",
      object: "store",
      action: "clarify",
      clarificationNeeded: false,
    });
  });

  it("routes colloquial multi-day store health asks onto the report lane", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "这几天义乌店怎么样",
      now,
    });

    expect(intent).toMatchObject({
      lane: "query",
      kind: "query",
      object: "store",
      action: "report",
      clarificationNeeded: false,
      capabilityId: "store_report_v1",
      timeFrameLabel: "近5天",
    });
    expect(intent.scope.orgIds).toEqual(["1001"]);
  });

  it("classifies customer asks with store and time but missing an operating lens into a customer guidance subtype", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "义乌店昨天顾客跟进重点看什么",
      now,
    });

    expect(intent).toMatchObject({
      lane: "meta",
      kind: "guidance_customer_missing_metric",
      object: "customer",
      action: "clarify",
      clarificationNeeded: false,
    });
  });

  it("classifies store asks missing a time range into a store guidance subtype", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "义乌店经营重点",
      now,
    });

    expect(intent).toMatchObject({
      lane: "meta",
      kind: "guidance_store_missing_time_range",
      object: "store",
      action: "clarify",
      clarificationNeeded: false,
    });
  });

  it("classifies colloquial amount asks with store and time into a store guidance missing-metric subtype", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "义乌店昨天盘里收了多少",
      now,
    });

    expect(intent).toMatchObject({
      lane: "meta",
      kind: "guidance_store_missing_metric",
      object: "store",
      action: "clarify",
      clarificationNeeded: false,
    });
  });

  it("keeps colloquial point/add clock status asks on the query lane instead of time-missing guidance", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "义乌店 近几天的加钟 点钟 情况",
      now,
    });

    expect(intent).toMatchObject({
      lane: "query",
      kind: "query",
      object: "store",
      clarificationNeeded: false,
      timeFrameLabel: "近5天",
    });
    expect(intent.scope.orgIds).toEqual(["1001"]);
  });

  it("treats fuzzy 近几天 + 怎么样 asks as an actual 5-day metric query instead of missing-time clarify", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "义乌店近几天点钟加钟怎么样",
      now,
    });

    expect(intent).toMatchObject({
      lane: "query",
      kind: "query",
      object: "store",
      action: "report",
      clarificationNeeded: false,
      timeFrameLabel: "近5天",
    });
    expect(intent.scope.orgIds).toEqual(["1001"]);
  });

  it("keeps 点加钟 colloquial combined asks on the query lane", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "义乌店近3天点加钟情况",
      now,
    });

    expect(intent).toMatchObject({
      lane: "query",
      kind: "query",
      object: "store",
      action: "summary",
      clarificationNeeded: false,
      timeFrameLabel: "近3天",
    });
    expect(intent.scope.orgIds).toEqual(["1001"]);
  });

  it("treats 最近有没有风险 as a risk query instead of missing-time guidance", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "义乌店最近有没有风险",
      now,
    });

    expect(intent).toMatchObject({
      lane: "query",
      kind: "query",
      object: "store",
      action: "risk",
      capabilityId: "store_risk_v1",
      clarificationNeeded: false,
      timeFrameLabel: "近30天",
    });
    expect(intent.scope.orgIds).toEqual(["1001"]);
  });

  it("treats 哪个门店须重点关注 as an HQ portfolio query instead of missing-time guidance", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "哪个门店须重点关注",
      now,
    });

    expect(intent).toMatchObject({
      lane: "query",
      kind: "query",
      object: "hq",
      action: "ranking",
      clarificationNeeded: false,
      timeFrameLabel: "近15天",
    });
    expect(intent.scope.allStores).toBe(true);
  });

  it("treats colloquial five-store window health asks as an HQ portfolio query", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "这几天五店怎么样",
      now,
    });

    expect(intent).toMatchObject({
      lane: "query",
      kind: "query",
      object: "hq",
      action: "ranking",
      clarificationNeeded: false,
      capabilityId: "hq_window_ranking_v1",
      timeFrameLabel: "近5天",
    });
    expect(intent.scope.allStores).toBe(true);
  });

  it("treats colloquial five-store window focus asks as an HQ portfolio query", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "五店近7天重点看什么",
      now,
    });

    expect(intent).toMatchObject({
      lane: "query",
      kind: "query",
      object: "hq",
      action: "ranking",
      clarificationNeeded: false,
      capabilityId: "hq_window_ranking_v1",
      timeFrameLabel: "近7天",
    });
    expect(intent.scope.allStores).toBe(true);
  });

  it("routes explicit HQ danger asks onto a dedicated HQ risk capability", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "五店近7天风险在哪",
      now,
    });

    expect(intent).toMatchObject({
      lane: "query",
      kind: "query",
      object: "hq",
      action: "risk",
      clarificationNeeded: false,
      capabilityId: "hq_portfolio_risk_v1",
      timeFrameLabel: "近7天",
    });
    expect(intent.scope.allStores).toBe(true);
  });

  it("treats explicit-window drag phrasing as an HQ portfolio ranking with the given time frame", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "五店近7天哪家营收拖后腿",
      now,
    });

    expect(intent).toMatchObject({
      lane: "query",
      kind: "query",
      object: "hq",
      action: "ranking",
      capabilityId: "hq_window_ranking_v1",
      clarificationNeeded: false,
      timeFrameLabel: "近7天",
    });
    expect(intent.scope.allStores).toBe(true);
  });

  it("treats explicit-window lowest phrasing as an HQ portfolio ranking instead of plain store ranking", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "五店近7天哪家营收最低",
      now,
    });

    expect(intent).toMatchObject({
      lane: "query",
      kind: "query",
      object: "hq",
      action: "ranking",
      capabilityId: "hq_window_ranking_v1",
      clarificationNeeded: false,
      timeFrameLabel: "近7天",
    });
    expect(intent.scope.allStores).toBe(true);
  });

  it("treats colloquial store repair asks as advice queries", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "义乌店近30天先补哪块",
      now,
    });

    expect(intent).toMatchObject({
      lane: "query",
      kind: "query",
      object: "store",
      action: "advice",
      capabilityId: "store_advice_v1",
      clarificationNeeded: false,
      timeFrameLabel: "近30天",
    });
    expect(intent.scope.orgIds).toEqual(["1001"]);
  });

  it("treats colloquial store weakest-link asks as risk queries", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "义乌店近30天哪块最扛不住",
      now,
    });

    expect(intent).toMatchObject({
      lane: "query",
      kind: "query",
      object: "store",
      action: "risk",
      capabilityId: "store_risk_v1",
      clarificationNeeded: false,
      timeFrameLabel: "近30天",
    });
    expect(intent.scope.orgIds).toEqual(["1001"]);
  });

  it("treats HQ rescue phrasing as an HQ portfolio query instead of store advice", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "五店近15天总部先救哪家",
      now,
    });

    expect(intent).toMatchObject({
      lane: "query",
      kind: "query",
      object: "hq",
      action: "advice",
      capabilityId: "hq_portfolio_focus_v1",
      clarificationNeeded: false,
      timeFrameLabel: "近15天",
    });
    expect(intent.scope.allStores).toBe(true);
  });

  it("keeps five-store review phrasing on the async HQ analysis lane", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "五店近7天经营复盘",
      now,
    });

    expect(intent).toMatchObject({
      lane: "analysis",
      kind: "analysis",
      object: "hq",
      action: "analysis",
      capabilityId: "portfolio_store_review_async_v1",
      clarificationNeeded: false,
      timeFrameLabel: "近7天",
    });
    expect(intent.scope.allStores).toBe(true);
  });

  it("routes explicit HQ risk ranking phrasing onto the dedicated HQ risk capability", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "五店近7天风险排序",
      now,
    });

    expect(intent).toMatchObject({
      lane: "query",
      kind: "query",
      object: "hq",
      action: "risk",
      capabilityId: "hq_portfolio_risk_v1",
      clarificationNeeded: false,
      timeFrameLabel: "近7天",
    });
    expect(intent.scope.allStores).toBe(true);
  });

  it("routes colloquial wait-experience asks with an explicit day to the wait capability", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "迎宾店昨天哪个时段最容易等",
      now,
    });

    expect(intent).toMatchObject({
      lane: "query",
      kind: "query",
      object: "wait_experience",
      action: "anomaly",
      capabilityId: "wait_experience_analysis_v1",
      clarificationNeeded: false,
      timeFrameLabel: "昨天",
    });
    expect(intent.scope.orgIds).toEqual(["1002"]);
  });

  it("routes colloquial arrival-profile asks with an explicit window to the arrival capability", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "迎宾店近7天客人都几点来",
      now,
    });

    expect(intent).toMatchObject({
      lane: "query",
      kind: "query",
      object: "store",
      action: "trend",
      capabilityId: "arrival_profile_timeseries_v1",
      clarificationNeeded: false,
      timeFrameLabel: "近7天",
    });
    expect(intent.scope.orgIds).toEqual(["1002"]);
  });

  it("routes recharge-without-visit member asks onto the customer segment lane", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "迎宾店谁充了钱还没来过",
      now,
    });

    expect(intent).toMatchObject({
      lane: "query",
      kind: "query",
      object: "customer",
      action: "list",
      capabilityId: "customer_ranked_list_lookup_v1",
      clarificationNeeded: false,
      timeFrameLabel: "2026-04-12",
    });
    expect(intent.scope.orgIds).toEqual(["1002"]);
  });

  it("treats colloquial store diagnosis asks as anomaly queries", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "义乌店近30天盘子哪里不对",
      now,
    });

    expect(intent).toMatchObject({
      lane: "query",
      kind: "query",
      object: "store",
      action: "anomaly",
      capabilityId: "store_anomaly_v1",
      clarificationNeeded: false,
      timeFrameLabel: "近30天",
    });
    expect(intent.scope.orgIds).toEqual(["1001"]);
  });

  it("treats colloquial HQ diagnosis asks as an HQ portfolio query", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "五店近30天整体哪里不对",
      now,
    });

    expect(intent).toMatchObject({
      lane: "query",
      kind: "query",
      object: "hq",
      action: "advice",
      capabilityId: "hq_portfolio_focus_v1",
      clarificationNeeded: false,
      timeFrameLabel: "近30天",
    });
    expect(intent.scope.allStores).toBe(true);
  });

  it("routes colloquial 盘子怎么样 with store+time onto the query report lane", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "义乌店近7天盘子怎么样",
      now,
    });

    expect(intent).toMatchObject({
      lane: "query",
      kind: "query",
      object: "store",
      action: "report",
      clarificationNeeded: false,
      capabilityId: "store_report_v1",
      timeFrameLabel: "近7天",
    });
    expect(intent.scope.orgIds).toEqual(["1001"]);
  });

  it("routes colloquial 生意好不好 with store onto the query lane", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "义乌店最近生意好不好",
      now,
    });

    expect(intent).toMatchObject({
      lane: "query",
      kind: "query",
      object: "store",
      action: "report",
      clarificationNeeded: false,
    });
    expect(intent.scope.orgIds).toEqual(["1001"]);
  });

  it("routes colloquial 哪块拖后腿了 without superlative onto the risk lane", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "义乌店近7天哪块拖后腿了",
      now,
    });

    expect(intent).toMatchObject({
      lane: "query",
      kind: "query",
      object: "store",
      action: "risk",
      capabilityId: "store_risk_v1",
      clarificationNeeded: false,
      timeFrameLabel: "近7天",
    });
    expect(intent.scope.orgIds).toEqual(["1001"]);
  });

  it("routes colloquial 客人跟得怎么样 with store+time onto the query lane", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "义乌店近7天客人跟得怎么样",
      now,
    });

    expect(intent).toMatchObject({
      lane: "query",
      kind: "query",
      clarificationNeeded: false,
      timeFrameLabel: "近7天",
    });
    expect(intent.scope.orgIds).toEqual(["1001"]);
  });

  it("routes colloquial 技师状态怎么样 with store+time onto the query lane", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "义乌店近7天技师状态怎么样",
      now,
    });

    expect(intent).toMatchObject({
      lane: "query",
      kind: "query",
      clarificationNeeded: false,
      timeFrameLabel: "近7天",
    });
    expect(intent.scope.orgIds).toEqual(["1001"]);
  });

  it("routes colloquial 复盘一下 with store+time onto the analysis lane", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "义乌店近30天复盘一下",
      now,
    });

    expect(intent).toMatchObject({
      lane: "analysis",
      kind: "analysis",
      object: "store",
      action: "analysis",
      clarificationNeeded: false,
    });
    expect(intent.scope.orgIds).toEqual(["1001"]);
  });

  it("routes colloquial 帮我看看 with store+time+metric onto the query lane", () => {
    const intent = resolveSemanticIntent({
      config,
      text: "帮我看看义乌店昨天营收",
      now,
    });

    expect(intent).toMatchObject({
      lane: "query",
      kind: "query",
      object: "store",
      clarificationNeeded: false,
    });
    expect(intent.scope.orgIds).toEqual(["1001"]);
  });
});
