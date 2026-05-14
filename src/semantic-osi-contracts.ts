export type SemanticOsiDomain = "customer" | "technician" | "store";

export type SemanticOsiField = {
  key: string;
  label: string;
  description: string;
  source_hint: string;
};

export type SemanticOsiMetric = {
  key: string;
  label: string;
  metric_ref?: string;
  description: string;
};

export type SemanticOsiSegment = {
  key: string;
  label: string;
  segment_ref?: string;
  description: string;
};

export type SemanticOsiRelationship = {
  key: string;
  from: string;
  to: string;
  description: string;
};

export type SemanticOsiCapabilityRef = {
  capability_id: string;
  purpose: string;
};

export type SemanticOsiRecipeRef = {
  recipe_ref: string;
  purpose: string;
};

export type SemanticOsiContract = {
  domain: SemanticOsiDomain;
  label: string;
  purpose: string;
  base_fields: SemanticOsiField[];
  metrics: SemanticOsiMetric[];
  segments: SemanticOsiSegment[];
  relationships: SemanticOsiRelationship[];
  capabilities: SemanticOsiCapabilityRef[];
  recipes: SemanticOsiRecipeRef[];
};

const SEMANTIC_OSI_CONTRACTS: SemanticOsiContract[] = [
  {
    domain: "customer",
    label: "客户 OSI",
    purpose: "把会员事实、标签、关系和动作闭环封装成 AI 可执行客户资产。",
    base_fields: [
      {
        key: "customer_identity_key",
        label: "客户统一键",
        description: "跨接口去重后的客户身份键。",
        source_hint: "member/profile/raw customer surfaces",
      },
      {
        key: "member_id",
        label: "会员 ID",
        description: "上游会员主键或卡号主键。",
        source_hint: "1.1 member",
      },
      {
        key: "org_id",
        label: "门店 ID",
        description: "客户归属或最近消费门店。",
        source_hint: "all upstream store-scoped APIs",
      },
      {
        key: "last_visit_date",
        label: "最近到店日期",
        description: "客户最近一次发生服务消费的营业日。",
        source_hint: "1.2 / 1.4 transactions",
      },
      {
        key: "stored_balance",
        label: "储值余额",
        description: "客户当前卡内可用储值余额。",
        source_hint: "1.1 member balance",
      },
      {
        key: "total_pay_amount",
        label: "累计实付",
        description: "客户历史实际支付金额。",
        source_hint: "1.2 / 1.4 transactions",
      },
      {
        key: "visit_count_90d",
        label: "90 天到店次数",
        description: "近 90 天服务消费次数。",
        source_hint: "1.2 / 1.4 transactions",
      },
      {
        key: "primary_tech_code",
        label: "主服务技师",
        description: "历史服务关系里绑定强度最高的技师。",
        source_hint: "1.6 tech service records",
      },
    ],
    metrics: [
      {
        key: "current_stored_balance",
        label: "当前储值余额",
        metric_ref: "metric:stored_balance",
        description: "识别高余额沉睡和储值压力。",
      },
      {
        key: "customer_lifetime_value",
        label: "客户累计价值",
        description: "基于累计实付、频次和近度形成客户价值分层。",
      },
      {
        key: "followup_score",
        label: "跟进优先级",
        description: "结合余额、沉睡天数、历史价值和最近互动形成唤回排序。",
      },
    ],
    segments: [
      {
        key: "high_balance_sleeping",
        label: "高余额沉睡会员",
        segment_ref: "segment:high_balance_silent_customer",
        description: "余额较高且长期未到店的会员。",
      },
      {
        key: "groupbuy_revisit_candidate",
        label: "团购复到店候选",
        segment_ref: "segment:groupbuy_revisit_customer",
        description: "团购首访后可推动二访或转会员的人群。",
      },
      {
        key: "recharge_not_visited_member",
        label: "充值未到店会员",
        segment_ref: "segment:recharge_not_visited_member",
        description: "充值后未发生服务消费的人群。",
      },
      {
        key: "birthday_window_member",
        label: "生日窗口会员",
        description: "近期生日或生日关怀窗口内的人群。",
      },
    ],
    relationships: [
      {
        key: "customer_to_store",
        from: "customer",
        to: "store",
        description: "客户归属、最近到店和跨店流动关系。",
      },
      {
        key: "customer_to_technician",
        from: "customer",
        to: "technician",
        description: "客户与服务技师之间的点钟、复购和绑定强度关系。",
      },
      {
        key: "customer_tag_to_action_recipe",
        from: "customer_tag",
        to: "action_recipe",
        description: "标签命中后关联名单、话术、负责人、执行状态和结果追踪。",
      },
    ],
    capabilities: [
      {
        capability_id: "customer_profile_lookup_v1",
        purpose: "查询单个客户画像。",
      },
      {
        capability_id: "customer_segment_list_v1",
        purpose: "查询客户分层名单。",
      },
      {
        capability_id: "customer_ranked_list_lookup_v1",
        purpose: "生成按优先级排序的客户行动名单。",
      },
      {
        capability_id: "customer_relation_lookup_v1",
        purpose: "查询客户与技师关系链。",
      },
    ],
    recipes: [
      {
        recipe_ref: "analysis:member_churn_review",
        purpose: "会员流失与唤回诊断。",
      },
      {
        recipe_ref: "analysis:customer_followup_task_review",
        purpose: "客户跟进任务生成。",
      },
      {
        recipe_ref: "analysis:groupbuy_conversion_review",
        purpose: "团购新客转化诊断。",
      },
    ],
  },
  {
    domain: "technician",
    label: "技师 OSI",
    purpose: "把技师供给、产能、口碑代理指标和客户绑定风险封装成可诊断对象。",
    base_fields: [
      {
        key: "tech_code",
        label: "技师编码",
        description: "技师统一识别码。",
        source_hint: "1.6 tech service records",
      },
      {
        key: "tech_name",
        label: "技师姓名",
        description: "技师展示名。",
        source_hint: "1.6 tech service records",
      },
      {
        key: "org_id",
        label: "门店 ID",
        description: "技师所属或当日服务门店。",
        source_hint: "1.5 / 1.6",
      },
      {
        key: "on_duty_days",
        label: "出勤天数",
        description: "统计窗口内实际上岗天数。",
        source_hint: "attendance / tech records",
      },
      {
        key: "service_revenue",
        label: "服务营收",
        description: "技师产生的服务类营收。",
        source_hint: "1.6 service records",
      },
      {
        key: "total_clock_count",
        label: "总钟数",
        description: "统计窗口内总上钟数。",
        source_hint: "1.6 service records",
      },
      {
        key: "point_clock_rate",
        label: "点钟率",
        description: "点钟记录占上钟记录比例。",
        source_hint: "1.6 service records",
      },
      {
        key: "add_clock_rate",
        label: "加钟率",
        description: "加钟记录占上钟记录比例。",
        source_hint: "1.6 service records",
      },
    ],
    metrics: [
      {
        key: "clockEffect",
        label: "钟效",
        metric_ref: "metric:tech_clock_efficiency",
        description: "技师单钟产出效率。",
      },
      {
        key: "pointClockRate",
        label: "点钟率",
        metric_ref: "metric:tech_point_clock_rate",
        description: "技师被顾客主动选择的强度。",
      },
      {
        key: "addClockRate",
        label: "加钟率",
        metric_ref: "metric:add_clock_rate",
        description: "技师服务后半程承接能力。",
      },
      {
        key: "serviceRevenue",
        label: "服务营收",
        metric_ref: "metric:tech_service_revenue",
        description: "技师直接创造的服务营收。",
      },
    ],
    segments: [
      {
        key: "high_output_technician",
        label: "高产出技师",
        description: "服务营收、钟效或钟数领先的技师。",
      },
      {
        key: "high_dependency_technician",
        label: "客户依赖技师",
        description: "绑定大量高余额客户的技师。",
      },
      {
        key: "low_conversion_technician",
        label: "低转化技师",
        description: "上钟多但点钟、加钟或副项偏弱的技师。",
      },
    ],
    relationships: [
      {
        key: "technician_to_store",
        from: "technician",
        to: "store",
        description: "技师所属门店和出勤门店。",
      },
      {
        key: "technician_to_customer",
        from: "technician",
        to: "customer",
        description: "技师服务客户、点钟客户和高余额客户绑定关系。",
      },
      {
        key: "technician_to_shift",
        from: "technician",
        to: "shift",
        description: "技师班次供给与时段产能关系。",
      },
    ],
    capabilities: [
      {
        capability_id: "tech_profile_lookup_v1",
        purpose: "查询单技师画像。",
      },
      {
        capability_id: "tech_leaderboard_ranking_v1",
        purpose: "查询技师排行榜。",
      },
      {
        capability_id: "tech_current_runtime_v1",
        purpose: "查询技师实时楼面状态。",
      },
    ],
    recipes: [
      {
        recipe_ref: "analysis:tech_daily_state_review",
        purpose: "技师日状态诊断。",
      },
      {
        recipe_ref: "analysis:tech_earnings_fairness_review",
        purpose: "技师产出与公平性诊断。",
      },
      {
        recipe_ref: "analysis:tech_dependency_risk_review",
        purpose: "技师客户依赖风险诊断。",
      },
    ],
  },
  {
    domain: "store",
    label: "门店 OSI",
    purpose: "把门店经营事实、指标口径、外部环境和动作建议统一成经营操作对象。",
    base_fields: [
      {
        key: "org_id",
        label: "门店 ID",
        description: "门店统一编码。",
        source_hint: "store config / all upstream APIs",
      },
      {
        key: "store_name",
        label: "门店名称",
        description: "荷塘悦色门店展示名。",
        source_hint: "store config",
      },
      {
        key: "biz_date",
        label: "营业日",
        description: "按门店营业日口径归属的日期。",
        source_hint: "daily mart",
      },
      {
        key: "service_revenue",
        label: "服务营收",
        description: "服务消费实付营收。",
        source_hint: "1.2 / daily mart",
      },
      {
        key: "customer_count",
        label: "消费人数",
        description: "营业日到店消费人数。",
        source_hint: "1.2 / daily mart",
      },
      {
        key: "total_clock_count",
        label: "总钟数",
        description: "营业日上钟总数。",
        source_hint: "1.6 / daily mart",
      },
      {
        key: "recharge_cash",
        label: "充值现金",
        description: "真实到账充值本金。",
        source_hint: "1.3 / daily mart",
      },
    ],
    metrics: [
      {
        key: "serviceRevenue",
        label: "服务营收",
        metric_ref: "metric:daily_cash_in",
        description: "门店服务类现金收入。",
      },
      {
        key: "customerCount",
        label: "客流",
        metric_ref: "metric:customer_count",
        description: "到店消费人数。",
      },
      {
        key: "averageTicket",
        label: "客单价",
        metric_ref: "metric:order_average_ticket",
        description: "单客消费强度。",
      },
      {
        key: "clockEffect",
        label: "钟效",
        metric_ref: "metric:tech_clock_efficiency",
        description: "单钟产出效率。",
      },
      {
        key: "pointClockRate",
        label: "点钟率",
        metric_ref: "metric:point_clock_rate",
        description: "顾客主动指定服务比例。",
      },
      {
        key: "addClockRate",
        label: "加钟率",
        metric_ref: "metric:add_clock_rate",
        description: "服务延长转化比例。",
      },
      {
        key: "cashPerformance",
        label: "现金业绩",
        metric_ref: "metric:cash_performance",
        description: "真实到账现金表现。",
      },
    ],
    segments: [
      {
        key: "revenue_decline_store",
        label: "营收下滑门店",
        description: "营收下滑且需拆客流、客单、项目结构的门店。",
      },
      {
        key: "traffic_decline_store",
        label: "客流下滑门店",
        description: "客流下降但供给未明显下降的门店。",
      },
      {
        key: "recharge_weak_store",
        label: "充值转弱门店",
        description: "消费正常但充值转弱的门店。",
      },
    ],
    relationships: [
      {
        key: "store_to_customer",
        from: "store",
        to: "customer",
        description: "门店会员资产、客流来源和复购关系。",
      },
      {
        key: "store_to_technician",
        from: "store",
        to: "technician",
        description: "门店技师供给、排班和产能关系。",
      },
      {
        key: "store_to_external_environment",
        from: "store",
        to: "external_environment",
        description: "天气、节假日、商圈、竞品、口碑等外部变量关系。",
      },
    ],
    capabilities: [
      {
        capability_id: "store_day_summary_v1",
        purpose: "查询单店单日摘要。",
      },
      {
        capability_id: "store_window_summary_v1",
        purpose: "查询单店时间窗摘要。",
      },
      {
        capability_id: "store_advice_v1",
        purpose: "生成门店动作建议。",
      },
      {
        capability_id: "hq_portfolio_overview_v1",
        purpose: "查询五店经营全景。",
      },
    ],
    recipes: [
      {
        recipe_ref: "analysis:store_health_review",
        purpose: "门店经营健康诊断。",
      },
      {
        recipe_ref: "analysis:week_vs_last_week_store",
        purpose: "本周对上周对比。",
      },
      {
        recipe_ref: "analysis:recharge_health_review",
        purpose: "充值健康诊断。",
      },
    ],
  },
];

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function listSemanticOsiContracts(): SemanticOsiContract[] {
  return clone(SEMANTIC_OSI_CONTRACTS);
}

export function getSemanticOsiContract(domain: SemanticOsiDomain): SemanticOsiContract | null {
  return clone(SEMANTIC_OSI_CONTRACTS.find((contract) => contract.domain === domain) ?? null);
}
