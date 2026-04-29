import { describe, expect, it } from "vitest";
import { resolveHetangOpsConfig } from "./config.js";
import { resolveHetangQueryIntent } from "./query-intent.js";
import { buildQueryPlanFromIntent } from "./query-plan.js";

function buildConfig() {
  return resolveHetangOpsConfig({
    api: {
      appSecret: "demo-app-secret",
    },
    database: {
      url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
    },
    stores: [
      { orgId: "1001", storeName: "义乌店" },
      { orgId: "1005", storeName: "迎宾店" },
    ],
  });
}

describe("buildQueryPlanFromIntent", () => {
  const config = buildConfig();
  const now = new Date("2026-04-08T10:00:00+08:00");

  it("builds a store summary plan for single-store metric asks", () => {
    const intent = resolveHetangQueryIntent({
      config,
      text: "义乌店昨天营收多少",
      now,
    });

    const plan = buildQueryPlanFromIntent({
      intent: intent!,
      effectiveOrgIds: ["1001"],
      accessScopeKind: "manager",
    });

    expect(plan).toMatchObject({
      entity: "store",
      action: "summary",
      response_shape: "scalar",
      metrics: ["serviceRevenue"],
      scope: {
        org_ids: ["1001"],
        scope_kind: "single",
      },
      time: {
        mode: "day",
        biz_date: "2026-04-07",
      },
    });
  });

  it("builds a store breakdown plan for total-clock composition asks", () => {
    const intent = resolveHetangQueryIntent({
      config,
      text: "义乌店昨日136个钟，是怎么构成的？",
      now,
    });

    const plan = buildQueryPlanFromIntent({
      intent: intent!,
      effectiveOrgIds: ["1001"],
      accessScopeKind: "manager",
    });

    expect(plan).toMatchObject({
      entity: "store",
      action: "breakdown",
      response_shape: "table",
      metrics: ["totalClockCount"],
      dimensions: ["clock_type"],
      scope: {
        org_ids: ["1001"],
        scope_kind: "single",
      },
      time: {
        mode: "day",
        biz_date: "2026-04-07",
      },
    });
  });

  it("builds a compare baseline for single-store window compare asks", () => {
    const intent = resolveHetangQueryIntent({
      config,
      text: "义乌店近7天营收对比",
      now,
    });

    const plan = buildQueryPlanFromIntent({
      intent: intent!,
      effectiveOrgIds: ["1001"],
      accessScopeKind: "manager",
    });

    expect(plan).toMatchObject({
      entity: "store",
      action: "compare",
      response_shape: "scalar",
      metrics: ["serviceRevenue"],
      scope: {
        org_ids: ["1001"],
        scope_kind: "single",
      },
      time: {
        mode: "window",
        start_biz_date: "2026-04-01",
        end_biz_date: "2026-04-07",
        window_days: 7,
      },
      compare: {
        baseline: "previous_window",
        start_biz_date: "2026-03-25",
        end_biz_date: "2026-03-31",
        window_days: 7,
        label: "前7天",
      },
    });
  });

  it("builds an hq ranking plan for portfolio asks", () => {
    const intent = resolveHetangQueryIntent({
      config,
      text: "五店近7天哪家店最危险",
      now,
    });

    const plan = buildQueryPlanFromIntent({
      intent: intent!,
      effectiveOrgIds: ["1001", "1005"],
      accessScopeKind: "hq",
    });

    expect(plan).toMatchObject({
      entity: "hq",
      action: "ranking",
      analysis: {
        mode: "executive_analysis",
        persona_id: "growth_exec_cgo_cmo_v1",
        framework_id: "hq_growth_priority_v1",
        audience: "hq",
      },
      response_shape: "ranking_list",
      metrics: ["riskScore"],
      scope: {
        org_ids: ["1001", "1005"],
        scope_kind: "all",
      },
      time: {
        mode: "window",
        window_days: 7,
      },
      sort: {
        metric: "riskScore",
        order: "desc",
      },
    });
  });

  it("keeps fact-only store metric plans free of the executive analysis lens", () => {
    const intent = resolveHetangQueryIntent({
      config,
      text: "义乌店昨天营收多少",
      now,
    });

    const plan = buildQueryPlanFromIntent({
      intent: intent!,
      effectiveOrgIds: ["1001"],
      accessScopeKind: "manager",
    });

    expect(plan.analysis).toBeUndefined();
  });

  it("attaches the store growth diagnosis lens to store advice asks", () => {
    const intent = resolveHetangQueryIntent({
      config,
      text: "义乌店近7天重点看什么",
      now,
    });

    const plan = buildQueryPlanFromIntent({
      intent: intent!,
      effectiveOrgIds: ["1001"],
      accessScopeKind: "manager",
    });

    expect(plan.analysis).toMatchObject({
      mode: "executive_analysis",
      persona_id: "growth_exec_cgo_cmo_v1",
      framework_id: "store_growth_diagnosis_v1",
      audience: "store",
      output_contract_id: "store_growth_brief_v2",
    });
  });

  it("routes single-store operations asks into the COO diagnosis lens", () => {
    const intent = resolveHetangQueryIntent({
      config,
      text: "义乌店近7天重点看什么，点钟率、加钟率还是翻房率",
      now,
    });

    const plan = buildQueryPlanFromIntent({
      intent: intent!,
      effectiveOrgIds: ["1001"],
      accessScopeKind: "manager",
    });

    expect(plan.analysis).toMatchObject({
      mode: "executive_analysis",
      persona_id: "operations_exec_coo_v1",
      framework_id: "store_operations_diagnosis_v1",
      audience: "store",
      output_contract_id: "store_operations_brief_v1",
    });
  });

  it("routes single-store profit asks into the CFO diagnosis lens", () => {
    const intent = resolveHetangQueryIntent({
      config,
      text: "义乌店近7天重点看什么，毛利率、净利率还是保本营收",
      now,
    });

    const plan = buildQueryPlanFromIntent({
      intent: intent!,
      effectiveOrgIds: ["1001"],
      accessScopeKind: "manager",
    });

    expect(plan.analysis).toMatchObject({
      mode: "executive_analysis",
      persona_id: "profit_exec_cfo_v1",
      framework_id: "store_profit_diagnosis_v1",
      audience: "store",
      output_contract_id: "store_profit_brief_v1",
    });
  });

  it("keeps single-store profit asks on the store diagnosis lens for HQ access", () => {
    const intent = resolveHetangQueryIntent({
      config,
      text: "义乌店近7天重点看什么，毛利率、净利率还是保本营收",
      now,
    });

    const plan = buildQueryPlanFromIntent({
      intent: intent!,
      effectiveOrgIds: ["1001"],
      accessScopeKind: "hq",
    });

    expect(plan.analysis).toMatchObject({
      mode: "executive_analysis",
      persona_id: "profit_exec_cfo_v1",
      framework_id: "store_profit_diagnosis_v1",
      audience: "store",
      output_contract_id: "store_profit_brief_v1",
    });
  });

  it("builds a store ranking plan for all-store window metric status asks", () => {
    const intent = resolveHetangQueryIntent({
      config,
      text: "5个店近一周的营收情况",
      now,
    });

    const plan = buildQueryPlanFromIntent({
      intent: intent!,
      effectiveOrgIds: ["1001", "1005"],
      accessScopeKind: "hq",
    });

    expect(plan).toMatchObject({
      entity: "store",
      action: "ranking",
      response_shape: "ranking_list",
      metrics: ["serviceRevenue"],
      scope: {
        org_ids: ["1001", "1005"],
        scope_kind: "all",
      },
      time: {
        mode: "window",
        window_days: 7,
      },
    });
  });

  it("builds a trend plan for single-store window metric status asks", () => {
    const intent = resolveHetangQueryIntent({
      config,
      text: "迎宾店近一周的营收情况",
      now,
    });

    const plan = buildQueryPlanFromIntent({
      intent: intent!,
      effectiveOrgIds: ["1005"],
      accessScopeKind: "manager",
    });

    expect(plan).toMatchObject({
      entity: "store",
      action: "trend",
      response_shape: "timeseries",
      metrics: ["serviceRevenue"],
      scope: {
        org_ids: ["1005"],
        scope_kind: "single",
      },
      time: {
        mode: "window",
        window_days: 7,
      },
    });
  });

  it("does not coerce combined point/add clock status asks into the generic status trend view", () => {
    const intent = resolveHetangQueryIntent({
      config,
      text: "义乌店近3天的点加钟情况",
      now,
    });

    const plan = buildQueryPlanFromIntent({
      intent: intent!,
      effectiveOrgIds: ["1001"],
      accessScopeKind: "manager",
    });

    expect(plan).toMatchObject({
      entity: "store",
      action: "summary",
      response_shape: "scalar",
      metrics: ["pointClockRate"],
      scope: {
        org_ids: ["1001"],
        scope_kind: "single",
      },
      time: {
        mode: "window",
        window_days: 3,
      },
    });
  });

  it("builds a tech ranking plan for technician leaderboard asks", () => {
    const intent = resolveHetangQueryIntent({
      config,
      text: "义乌店昨天技师点钟率排名",
      now,
    });

    const plan = buildQueryPlanFromIntent({
      intent: intent!,
      effectiveOrgIds: ["1001"],
      accessScopeKind: "manager",
    });

    expect(plan).toMatchObject({
      entity: "tech",
      action: "ranking",
      response_shape: "ranking_list",
      metrics: ["pointClockRate"],
      scope: {
        org_ids: ["1001"],
        scope_kind: "single",
      },
      time: {
        mode: "day",
        biz_date: "2026-04-07",
      },
      sort: {
        metric: "pointClockRate",
        order: "desc",
      },
    });
  });

  it("builds a customer profile lookup plan for phone-suffix asks", () => {
    const intent = resolveHetangQueryIntent({
      config,
      text: "义乌店尾号7500客户画像",
      now,
    });

    const plan = buildQueryPlanFromIntent({
      intent: intent!,
      effectiveOrgIds: ["1001"],
      accessScopeKind: "manager",
    });

    expect(plan).toMatchObject({
      entity: "customer_profile",
      action: "profile",
      response_shape: "profile_card",
      scope: {
        org_ids: ["1001"],
        scope_kind: "single",
      },
      filters: [
        {
          field: "phone_suffix",
          op: "=",
          value: "7500",
        },
      ],
      time: {
        mode: "as_of",
      },
    });
  });

  it("builds a customer follow-up list plan for ranked-list asks", () => {
    const intent = resolveHetangQueryIntent({
      config,
      text: "迎宾店高价值待唤回名单",
      now,
    });

    const plan = buildQueryPlanFromIntent({
      intent: intent!,
      effectiveOrgIds: ["1005"],
      accessScopeKind: "manager",
    });

    expect(plan).toMatchObject({
      entity: "customer_profile",
      action: "list",
      response_shape: "ranking_list",
      scope: {
        org_ids: ["1005"],
        scope_kind: "single",
      },
      metrics: ["riskScore"],
      filters: [
        {
          field: "followup_bucket",
          op: "=",
          value: "high-value-reactivation",
        },
      ],
      time: {
        mode: "as_of",
      },
    });
  });

  it("builds a segment-filtered customer list plan for explicit segment list asks", () => {
    const intent = resolveHetangQueryIntent({
      config,
      text: "迎宾店沉睡会员名单",
      now,
    });

    const plan = buildQueryPlanFromIntent({
      intent: intent!,
      effectiveOrgIds: ["1005"],
      accessScopeKind: "manager",
    });

    expect(plan).toMatchObject({
      entity: "customer_profile",
      action: "list",
      response_shape: "ranking_list",
      scope: {
        org_ids: ["1005"],
        scope_kind: "single",
      },
      metrics: [],
      dimensions: ["segment"],
      filters: [
        {
          field: "primary_segment",
          op: "=",
          value: "sleeping-customer",
        },
      ],
      sort: {
        metric: "payAmount90d",
        order: "desc",
      },
      limit: 20,
      time: {
        mode: "as_of",
      },
    });
  });

  it("builds a segment-filtered customer count plan for explicit segment count asks", () => {
    const intent = resolveHetangQueryIntent({
      config,
      text: "重要价值会员有多少",
      now,
    });

    const plan = buildQueryPlanFromIntent({
      intent: intent!,
      effectiveOrgIds: ["1001"],
      accessScopeKind: "manager",
    });

    expect(plan).toMatchObject({
      entity: "customer_profile",
      action: "list",
      response_shape: "scalar",
      scope: {
        org_ids: ["1001"],
        scope_kind: "single",
      },
      metrics: [],
      dimensions: ["segment"],
      filters: [
        {
          field: "primary_segment",
          op: "=",
          value: "important-value-member",
        },
      ],
      time: {
        mode: "as_of",
      },
    });
    expect(plan.limit).toBeUndefined();
  });

  it("builds a segment-filtered tech-binding ranking plan for segment loyalty asks", () => {
    const intent = resolveHetangQueryIntent({
      config,
      text: "义乌店哪个技师绑定的高价值会员最多",
      now,
    });

    const plan = buildQueryPlanFromIntent({
      intent: intent!,
      effectiveOrgIds: ["1001"],
      accessScopeKind: "manager",
    });

    expect(plan).toMatchObject({
      entity: "customer_profile",
      action: "list",
      response_shape: "ranking_list",
      scope: {
        org_ids: ["1001"],
        scope_kind: "single",
      },
      metrics: [],
      dimensions: ["segment", "tech"],
      filters: [
        {
          field: "primary_segment",
          op: "=",
          value: "important-value-member",
        },
      ],
      time: {
        mode: "as_of",
      },
    });
  });

  it("builds a store report plan for single-store report asks", () => {
    const intent = resolveHetangQueryIntent({
      config,
      text: "义乌店昨天日报",
      now,
    });

    const plan = buildQueryPlanFromIntent({
      intent: intent!,
      effectiveOrgIds: ["1001"],
      accessScopeKind: "manager",
    });

    expect(plan).toMatchObject({
      entity: "store",
      action: "report",
      response_shape: "narrative",
      scope: {
        org_ids: ["1001"],
        scope_kind: "single",
      },
      time: {
        mode: "day",
        biz_date: "2026-04-07",
      },
    });
  });

  it("builds a store advice plan for store-action asks", () => {
    const intent = resolveHetangQueryIntent({
      config,
      text: "义乌店今天该先抓什么",
      now,
    });

    const plan = buildQueryPlanFromIntent({
      intent: intent!,
      effectiveOrgIds: ["1001"],
      accessScopeKind: "manager",
    });

    expect(plan).toMatchObject({
      entity: "store",
      action: "advice",
      response_shape: "narrative",
      metrics: ["riskScore"],
      scope: {
        org_ids: ["1001"],
        scope_kind: "single",
      },
    });
  });

  it("builds a birthday-member list plan for birthday follow-up asks", () => {
    const intent = resolveHetangQueryIntent({
      config,
      text: "迎宾店明天过生日的高价值会员有哪些",
      now,
    });

    const plan = buildQueryPlanFromIntent({
      intent: intent!,
      effectiveOrgIds: ["1005"],
      accessScopeKind: "manager",
    });

    expect(plan).toMatchObject({
      entity: "customer_profile",
      action: "list",
      response_shape: "ranking_list",
      scope: {
        org_ids: ["1005"],
        scope_kind: "single",
      },
      time: {
        mode: "day",
        biz_date: "2026-04-09",
      },
      metrics: [],
      dimensions: [],
    });
  });

  it("builds a wait-experience plan for wait analysis asks", () => {
    const intent = resolveHetangQueryIntent({
      config,
      text: "迎宾店昨天哪个时段等待最长",
      now,
    });

    const plan = buildQueryPlanFromIntent({
      intent: intent!,
      effectiveOrgIds: ["1005"],
      accessScopeKind: "manager",
    });

    expect(plan).toMatchObject({
      entity: "store",
      action: "anomaly",
      response_shape: "narrative",
      scope: {
        org_ids: ["1005"],
        scope_kind: "single",
      },
      time: {
        mode: "day",
        biz_date: "2026-04-07",
      },
      metrics: [],
      dimensions: ["time_bucket"],
    });
  });

  it("builds an arrival-profile timeseries plan for time-slot arrival asks", () => {
    const intent = resolveHetangQueryIntent({
      config,
      text: "统计迎宾店过去一周每天平均各个时段到店的人数，从下午2点到晚上2点。",
      now,
    });

    const plan = buildQueryPlanFromIntent({
      intent: intent!,
      effectiveOrgIds: ["1005"],
      accessScopeKind: "manager",
    });

    expect(plan).toMatchObject({
      entity: "store",
      action: "trend",
      response_shape: "timeseries",
      scope: {
        org_ids: ["1005"],
        scope_kind: "single",
      },
      time: {
        mode: "window",
        window_days: 7,
      },
      metrics: [],
      dimensions: ["hour_bucket"],
    });
  });

  it("builds a member-marketing ranking plan for source-silence asks", () => {
    const intent = resolveHetangQueryIntent({
      config,
      text: "义乌店哪种来源的会员更容易沉默",
      now,
    });

    const plan = buildQueryPlanFromIntent({
      intent: intent!,
      effectiveOrgIds: ["1001"],
      accessScopeKind: "manager",
    });

    expect(plan).toMatchObject({
      entity: "customer_profile",
      action: "ranking",
      response_shape: "ranking_list",
      scope: {
        org_ids: ["1001"],
        scope_kind: "single",
      },
      time: {
        mode: "as_of",
      },
      metrics: [],
      dimensions: ["source"],
    });
  });

  it("builds a recharge-attribution ranking plan for card-type asks", () => {
    const intent = resolveHetangQueryIntent({
      config,
      text: "迎宾店近30天哪种卡型充值最好",
      now,
    });

    const plan = buildQueryPlanFromIntent({
      intent: intent!,
      effectiveOrgIds: ["1005"],
      accessScopeKind: "manager",
    });

    expect(plan).toMatchObject({
      entity: "store",
      action: "ranking",
      response_shape: "ranking_list",
      scope: {
        org_ids: ["1005"],
        scope_kind: "single",
      },
      time: {
        mode: "window",
        window_days: 30,
      },
      metrics: [],
      dimensions: ["card_type"],
    });
  });

  it("builds a tech-profile plan for technician profile asks", () => {
    const intent = resolveHetangQueryIntent({
      config,
      text: "义乌店 技师 白慧慧 的画像",
      now,
    });

    const plan = buildQueryPlanFromIntent({
      intent: intent!,
      effectiveOrgIds: ["1001"],
      accessScopeKind: "manager",
    });

    expect(plan).toMatchObject({
      entity: "tech",
      action: "profile",
      response_shape: "profile_card",
      scope: {
        org_ids: ["1001"],
        scope_kind: "single",
      },
      time: {
        mode: "window",
        window_days: 30,
      },
      metrics: [],
      dimensions: [],
    });
  });
});
