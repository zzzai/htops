import type { DailyStoreMetrics } from "./types.js";

export type BusinessPainSignalSeverity = "info" | "warn" | "critical";

export type BusinessPainSignalId =
  | "pain:revenue_drop"
  | "pain:traffic_drop"
  | "pain:recharge_weakening"
  | "pain:stored_value_pressure"
  | "pain:new_customer_waste"
  | "pain:tech_dependency"
  | "pain:tech_productivity_anomaly"
  | "pain:point_clock_drop"
  | "pain:attendance_anomaly"
  | "pain:anti_settle_anomaly"
  | "pain:discount_anomaly"
  | "pain:data_risk";

export type BusinessPainSignalContract = {
  id: BusinessPainSignalId;
  category: string;
  activeSignal: string;
  businessMeaning: string;
  defaultAction: string;
  metricRefs: string[];
};

export type BusinessPainSignal = BusinessPainSignalContract & {
  severity: BusinessPainSignalSeverity;
  score: number;
  evidence: string;
  recommendedAction: string;
};

export type BusinessPainSignalEvaluationInput = {
  current: DailyStoreMetrics;
  baseline?: DailyStoreMetrics | null;
  financial?: {
    originalAmount?: number;
    discountAmount?: number;
  };
  techDependency?: {
    topTechName?: string;
    topTechVisitShare90d?: number | null;
    boundStoredBalanceAmount?: number;
  };
  maxSignals?: number;
};

export const BUSINESS_PAIN_SIGNAL_CONTRACTS: BusinessPainSignalContract[] = [
  {
    id: "pain:revenue_drop",
    category: "营收下滑",
    activeSignal: "服务营收环比下降，但客流没降",
    businessMeaning: "可能是客单价/项目结构问题",
    defaultAction: "拆服务项目结构、客单价和高客单项目成交，先找掉价而不是只补客流。",
    metricRefs: ["serviceRevenue", "customerCount", "averageTicket"],
  },
  {
    id: "pain:traffic_drop",
    category: "客流下滑",
    activeSignal: "到店人数下降，技师出勤正常",
    businessMeaning: "门店获客或老客回访问题",
    defaultAction: "先拆新客、老客和团购来源，客服优先补预约和老客回流。",
    metricRefs: ["customerCount", "onDutyTechCount"],
  },
  {
    id: "pain:recharge_weakening",
    category: "充值变弱",
    activeSignal: "消费正常但充值下降",
    businessMeaning: "老客还在消耗，但续费意愿变弱",
    defaultAction: "筛近30天有消费但未充值会员，今天做续充收口和到店触达。",
    metricRefs: ["rechargeCash", "serviceRevenue", "storedConsumeAmount"],
  },
  {
    id: "pain:stored_value_pressure",
    category: "储值压力",
    activeSignal: "高余额会员长期不来",
    businessMeaning: "钱趴在卡里，未来流失和负债压力",
    defaultAction: "按余额和沉默天数拉唤回名单，先处理高余额高沉默会员。",
    metricRefs: ["highBalanceSleepingMemberCount", "highBalanceSleepingMemberAmount"],
  },
  {
    id: "pain:new_customer_waste",
    category: "新客浪费",
    activeSignal: "团购/新客来过但 7/30 天无二访",
    businessMeaning: "拉新成本浪费",
    defaultAction: "把首单团购客按7天未复到店拉名单，前台和客服补二次预约。",
    metricRefs: ["groupbuyCohortCustomerCount", "groupbuy7dRevisitRate"],
  },
  {
    id: "pain:tech_dependency",
    category: "技师依赖",
    activeSignal: "某技师绑定大量高余额客户",
    businessMeaning: "离职即门店风险",
    defaultAction: "把高依赖顾客拆到门店关系池，安排第二服务技师和店长关系维护。",
    metricRefs: ["topTechVisitShare90d", "boundStoredBalanceAmount"],
  },
  {
    id: "pain:tech_productivity_anomaly",
    category: "技师产能异常",
    activeSignal: "上钟多但副项/加钟低",
    businessMeaning: "服务转化能力弱",
    defaultAction: "复盘高钟数技师的加钟和副项推荐，班前会统一服务后半程收口动作。",
    metricRefs: ["totalClockCount", "addClockRate", "marketRevenue"],
  },
  {
    id: "pain:point_clock_drop",
    category: "点钟率异常",
    activeSignal: "点钟率突然下降",
    businessMeaning: "口碑或排班问题",
    defaultAction: "复盘低点钟班次、前台推荐和技师口碑，晚高峰优先安排强点钟技师。",
    metricRefs: ["pointClockRate"],
  },
  {
    id: "pain:attendance_anomaly",
    category: "出勤异常",
    activeSignal: "在册人数够，但日均出勤率低",
    businessMeaning: "排班/稳定性问题",
    defaultAction: "店长先核排班缺口和请休假原因，保证高峰班实际供给。",
    metricRefs: ["activeTechCount", "onDutyTechCount"],
  },
  {
    id: "pain:anti_settle_anomaly",
    category: "反结异常",
    activeSignal: "反结金额或次数突增",
    businessMeaning: "财务和管理风险",
    defaultAction: "复核大额反结、同日多笔反结和操作人异常，先做账务闭环。",
    metricRefs: ["antiServiceRevenue"],
  },
  {
    id: "pain:discount_anomaly",
    category: "折扣异常",
    activeSignal: "实收与标价差距扩大",
    businessMeaning: "优惠失控或员工操作问题",
    defaultAction: "复核折扣来源、授权人和活动口径，避免优惠侵蚀现金业绩。",
    metricRefs: ["discountAmount", "originalAmount"],
  },
  {
    id: "pain:data_risk",
    category: "数据风险",
    activeSignal: "某接口数据缺口影响回答/日报",
    businessMeaning: "系统可信度风险",
    defaultAction: "先补齐缺口接口和日报口径，再对外发布正式经营判断。",
    metricRefs: ["incompleteSync", "unavailableMetrics", "staleSyncEndpoints"],
  },
];

const CONTRACT_BY_ID = new Map(
  BUSINESS_PAIN_SIGNAL_CONTRACTS.map((contract) => [contract.id, contract] as const),
);

function percentDelta(current: number | null | undefined, baseline: number | null | undefined): number | null {
  if (
    current === null ||
    current === undefined ||
    baseline === null ||
    baseline === undefined ||
    !Number.isFinite(current) ||
    !Number.isFinite(baseline) ||
    baseline <= 0
  ) {
    return null;
  }
  return (current - baseline) / baseline;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1).replace(/\.0$/u, "")}%`;
}

function formatAmount(value: number): string {
  if (Math.abs(value) >= 10_000) {
    return `${(value / 10_000).toFixed(1).replace(/\.0$/u, "")}万`;
  }
  return `${Math.round(value)}元`;
}

function severityFromScore(score: number): BusinessPainSignalSeverity {
  if (score >= 85) {
    return "critical";
  }
  if (score >= 55) {
    return "warn";
  }
  return "info";
}

function addSignal(
  signals: BusinessPainSignal[],
  id: BusinessPainSignalId,
  params: {
    score: number;
    evidence: string;
    recommendedAction?: string;
  },
): void {
  if (signals.some((signal) => signal.id === id)) {
    return;
  }
  const contract = CONTRACT_BY_ID.get(id);
  if (!contract) {
    return;
  }
  signals.push({
    ...contract,
    score: Math.round(params.score),
    severity: severityFromScore(params.score),
    evidence: params.evidence,
    recommendedAction: params.recommendedAction ?? contract.defaultAction,
  });
}

export function evaluateBusinessPainSignals(
  input: BusinessPainSignalEvaluationInput,
): BusinessPainSignal[] {
  const { current, baseline } = input;
  const signals: BusinessPainSignal[] = [];
  const revenueDelta = percentDelta(current.serviceRevenue, baseline?.serviceRevenue);
  const trafficDelta = percentDelta(current.customerCount, baseline?.customerCount);
  const rechargeDelta = percentDelta(current.rechargeCash, baseline?.rechargeCash);
  const staffingDelta = percentDelta(current.onDutyTechCount, baseline?.onDutyTechCount);
  const pointClockDelta = percentDelta(current.pointClockRate, baseline?.pointClockRate);

  if (revenueDelta !== null && revenueDelta <= -0.12 && (trafficDelta === null || trafficDelta > -0.05)) {
    addSignal(signals, "pain:revenue_drop", {
      score: 70 + Math.abs(revenueDelta) * 100,
      evidence: `服务营收较基准 ${formatPercent(revenueDelta)}，客流${trafficDelta === null ? "未提供基准" : `仅 ${formatPercent(trafficDelta)}`}`,
    });
  }

  if (trafficDelta !== null && trafficDelta <= -0.12 && (staffingDelta === null || staffingDelta > -0.08)) {
    addSignal(signals, "pain:traffic_drop", {
      score: 66 + Math.abs(trafficDelta) * 100,
      evidence: `到店人数较基准 ${formatPercent(trafficDelta)}，技师出勤${staffingDelta === null ? "未见下降基准" : `变化 ${formatPercent(staffingDelta)}`}`,
    });
  }

  if (rechargeDelta !== null && rechargeDelta <= -0.2 && (revenueDelta === null || revenueDelta > -0.1)) {
    addSignal(signals, "pain:recharge_weakening", {
      score: 68 + Math.abs(rechargeDelta) * 80,
      evidence: `充值本金较基准 ${formatPercent(rechargeDelta)}，服务营收${revenueDelta === null ? "未提供基准" : `变化 ${formatPercent(revenueDelta)}`}`,
    });
  }

  const highBalanceSleepingCount = current.highBalanceSleepingMemberCount ?? 0;
  const highBalanceSleepingAmount = current.highBalanceSleepingMemberAmount ?? 0;
  if (
    highBalanceSleepingCount > 0 &&
    (highBalanceSleepingAmount >= 5_000 || (current.sleepingMemberRate ?? 0) >= 0.15)
  ) {
    addSignal(signals, "pain:stored_value_pressure", {
      score: 58 + Math.min(35, highBalanceSleepingCount * 4 + highBalanceSleepingAmount / 2_000),
      evidence: `高余额沉默会员 ${highBalanceSleepingCount} 人，余额约 ${formatAmount(highBalanceSleepingAmount)}`,
    });
  }

  const groupbuyCohort = current.groupbuyCohortCustomerCount;
  const groupbuyRevisitRate = current.groupbuy7dRevisitRate;
  if (
    groupbuyCohort >= 8 &&
    groupbuyRevisitRate !== null &&
    groupbuyRevisitRate !== undefined &&
    groupbuyRevisitRate < 0.35
  ) {
    addSignal(signals, "pain:new_customer_waste", {
      score: 60 + (0.35 - groupbuyRevisitRate) * 120,
      evidence: `团购样本 ${groupbuyCohort} 人，7天复到店率 ${formatPercent(groupbuyRevisitRate)}`,
    });
  }

  const topTechVisitShare = input.techDependency?.topTechVisitShare90d;
  const boundStoredBalance = input.techDependency?.boundStoredBalanceAmount ?? 0;
  if (
    topTechVisitShare !== null &&
    topTechVisitShare !== undefined &&
    topTechVisitShare >= 0.35
  ) {
    addSignal(signals, "pain:tech_dependency", {
      score: 62 + (topTechVisitShare - 0.35) * 120 + Math.min(12, boundStoredBalance / 10_000),
      evidence: `${input.techDependency?.topTechName ?? "某技师"} 绑定顾客占比 ${formatPercent(topTechVisitShare)}，关联储值约 ${formatAmount(boundStoredBalance)}`,
    });
  }

  const marketRevenueShare =
    current.serviceRevenue > 0 ? current.marketRevenue / current.serviceRevenue : null;
  if (
    current.totalClockCount >= 80 &&
    ((current.addClockRate ?? 1) < 0.12 || (marketRevenueShare !== null && marketRevenueShare < 0.03))
  ) {
    addSignal(signals, "pain:tech_productivity_anomaly", {
      score: 58 + Math.min(25, current.totalClockCount / 10) + ((current.addClockRate ?? 1) < 0.12 ? 8 : 0),
      evidence: `总钟数 ${current.totalClockCount}，加钟率 ${current.addClockRate === null ? "N/A" : formatPercent(current.addClockRate)}，副项占比 ${marketRevenueShare === null ? "N/A" : formatPercent(marketRevenueShare)}`,
    });
  }

  if ((current.pointClockRate ?? 1) < 0.25 || (pointClockDelta !== null && pointClockDelta <= -0.12)) {
    addSignal(signals, "pain:point_clock_drop", {
      score: 56 + (current.pointClockRate === null ? 0 : (0.35 - current.pointClockRate) * 90),
      evidence: `点钟率 ${current.pointClockRate === null ? "N/A" : formatPercent(current.pointClockRate)}${pointClockDelta === null ? "" : `，较基准 ${formatPercent(pointClockDelta)}`}`,
    });
  }

  const attendanceRate =
    current.activeTechCount > 0 ? current.onDutyTechCount / current.activeTechCount : null;
  if (
    attendanceRate !== null &&
    current.activeTechCount >= 8 &&
    current.activeTechCount - current.onDutyTechCount >= 3 &&
    attendanceRate < 0.75
  ) {
    addSignal(signals, "pain:attendance_anomaly", {
      score: 54 + (0.75 - attendanceRate) * 100,
      evidence: `在册/活跃 ${current.activeTechCount} 人，实际上岗 ${current.onDutyTechCount} 人，出勤率 ${formatPercent(attendanceRate)}`,
    });
  }

  const antiAmount = Math.abs(current.antiServiceRevenue);
  const antiBase = current.serviceRevenue + antiAmount;
  const antiRate = antiBase > 0 ? antiAmount / antiBase : 0;
  if (antiAmount >= 500 && antiRate >= 0.03) {
    addSignal(signals, "pain:anti_settle_anomaly", {
      score: 62 + Math.min(25, antiRate * 200),
      evidence: `反结/退款金额 ${formatAmount(antiAmount)}，占相关服务金额 ${formatPercent(antiRate)}`,
    });
  }

  const discountAmount = input.financial?.discountAmount ?? 0;
  const originalAmount = input.financial?.originalAmount ?? 0;
  const discountRate = originalAmount > 0 ? discountAmount / originalAmount : 0;
  if (discountAmount >= 500 && discountRate >= 0.12) {
    addSignal(signals, "pain:discount_anomaly", {
      score: 55 + Math.min(30, discountRate * 120),
      evidence: `折扣/赠送金额 ${formatAmount(discountAmount)}，标价口径占比 ${formatPercent(discountRate)}`,
    });
  }

  if (
    current.incompleteSync ||
    current.unavailableMetrics.length > 0 ||
    (current.staleSyncEndpoints?.length ?? 0) > 0
  ) {
    addSignal(signals, "pain:data_risk", {
      score: 95,
      evidence: `同步未闭环=${current.incompleteSync ? "是" : "否"}，不可用指标 ${current.unavailableMetrics.join(",") || "无"}，过期接口 ${(current.staleSyncEndpoints ?? []).join(",") || "无"}`,
    });
  }

  return signals
    .sort((left, right) => right.score - left.score || left.category.localeCompare(right.category, "zh-Hans-CN"))
    .slice(0, Math.max(0, input.maxSignals ?? signals.length));
}

export function renderBusinessPainSignalSuggestion(signal: BusinessPainSignal): string {
  return `痛点雷达【${signal.category}】：${signal.businessMeaning}。证据：${signal.evidence}。建议：${signal.recommendedAction}`;
}
