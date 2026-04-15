import type {
  CustomerPaymentSegment,
  CustomerPrimarySegment,
  CustomerTechLoyaltySegment,
} from "./types.js";

export type CustomerBusinessSignal = {
  tierLabel: string;
  riskLabel: "高" | "中" | "低";
  tags: string[];
  actionPriority: string;
};

export type TechBusinessSignal = {
  levelLabel: string;
  tags: string[];
  actionPriority: string;
};

export type TechCustomerBindingState = "ready" | "partial" | "missing";

export type StoreBusinessSignal = {
  levelLabel: string;
  tags: string[];
  actionPriority: string;
};

function dedupeTags(tags: string[]): string[] {
  return Array.from(
    new Set(
      tags
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0),
    ),
  );
}

export function evaluateCustomerBusinessScore(params: {
  primarySegment?: CustomerPrimarySegment;
  paymentSegment?: CustomerPaymentSegment;
  techLoyaltySegment?: CustomerTechLoyaltySegment;
  payAmount90d: number;
  visitCount90d: number;
  silentDays: number;
}): CustomerBusinessSignal {
  const payAmount90d = Number.isFinite(params.payAmount90d) ? params.payAmount90d : 0;
  const visitCount90d = Number.isFinite(params.visitCount90d) ? params.visitCount90d : 0;

  let tierLabel = "基础维护";
  if (params.primarySegment === "important-reactivation-member") {
    tierLabel = "高价值待唤回";
  } else if (
    params.primarySegment === "important-value-member" ||
    payAmount90d >= 1200 ||
    visitCount90d >= 5
  ) {
    tierLabel = "高价值稳态";
  } else if (
    params.primarySegment === "potential-growth-customer" ||
    payAmount90d >= 600 ||
    visitCount90d >= 3
  ) {
    tierLabel = "潜力成长";
  } else if (
    params.primarySegment === "groupbuy-retain-candidate" ||
    params.paymentSegment === "groupbuy-only" ||
    params.paymentSegment === "groupbuy-plus-direct"
  ) {
    tierLabel = "团购留存";
  }

  const riskLabel =
    params.primarySegment === "important-reactivation-member" || params.silentDays >= 45
      ? "高"
      : params.silentDays >= 30
        ? "中"
        : "低";

  const tags = dedupeTags([
    tierLabel,
    riskLabel === "高" ? "沉默风险高" : params.silentDays >= 7 ? "沉默预警" : "",
    params.techLoyaltySegment === "single-tech-loyal" ? "技师偏好稳定" : "",
    params.paymentSegment === "groupbuy-only" || params.paymentSegment === "groupbuy-plus-direct"
      ? "团购待转化"
      : "",
  ]).slice(0, 4);

  let actionPriority = "先做基础维护，确认最近一次服务体验，再决定是否加大触达。";
  if (tierLabel === "高价值待唤回") {
    actionPriority = "先人工唤回，再围绕熟悉技师和主项目重建联系。";
  } else if (tierLabel === "团购留存") {
    actionPriority = "先盯二次到店，再推进开卡和储值承接。";
  } else if (tierLabel === "潜力成长") {
    actionPriority = "优先把本月消费推进到会员复购或储值。";
  } else if (tierLabel === "高价值稳态") {
    actionPriority = "优先约下一次到店，不急着靠发券驱动。";
  } else if (riskLabel === "中") {
    actionPriority = "先人工跟进，别让客户继续转冷。";
  }

  return {
    tierLabel,
    riskLabel,
    tags,
    actionPriority,
  };
}

export function evaluateTechBusinessScore(params: {
  customerBindingState: TechCustomerBindingState;
  uniqueCustomerCount: number;
  pointClockRate: number | null;
  addClockRate: number | null;
  marketRevenue: number;
  importantValueCustomerCount: number;
}): TechBusinessSignal {
  const pointClockRate = params.pointClockRate ?? 0;
  const addClockRate = params.addClockRate ?? 0;
  const marketRevenue = Number.isFinite(params.marketRevenue) ? params.marketRevenue : 0;

  let levelLabel = "待提升";
  if (params.customerBindingState !== "ready") {
    levelLabel = "待补判断";
  } else if (
    pointClockRate >= 0.55 &&
    addClockRate >= 0.2 &&
    (params.importantValueCustomerCount > 0 || params.uniqueCustomerCount >= 4)
  ) {
    levelLabel = "强势型";
  } else if (pointClockRate >= 0.4 && addClockRate >= 0.15) {
    levelLabel = "稳健型";
  }

  const tags = dedupeTags([
    params.customerBindingState === "missing"
      ? "顾客绑定待补"
      : params.customerBindingState === "partial"
        ? "顾客绑定覆盖不足"
        : "",
    pointClockRate >= 0.5 ? "点钟强" : pointClockRate < 0.3 ? "点钟弱" : "",
    addClockRate >= 0.2 ? "加钟在线" : addClockRate < 0.15 ? "加钟弱" : "",
    params.importantValueCustomerCount > 0 ? "高价值会员承接好" : "",
    params.customerBindingState === "ready" && params.uniqueCustomerCount <= 2 ? "顾客池待扩" : "",
    marketRevenue > 0 ? "副项承接在线" : marketRevenue <= 0 ? "副项偏弱" : "",
  ]).slice(0, 5);

  let actionPriority = "继续放大高峰班承接，把强项稳定复制给更多顾客。";
  if (params.customerBindingState !== "ready") {
    actionPriority = "先补客户-技师绑定，再判断留客和复购归属。";
  } else if (params.uniqueCustomerCount <= 2) {
    actionPriority = "先扩稳定顾客池，再放大高峰时段承接。";
  } else if (pointClockRate < 0.3 && addClockRate < 0.15) {
    actionPriority = "先补点钟展示和加钟收口，两头一起抓。";
  } else if (pointClockRate < 0.3) {
    actionPriority = "先补指定客维护和点钟展示。";
  } else if (addClockRate < 0.15) {
    actionPriority = "先把服务后半程加钟收口固定下来。";
  } else if (marketRevenue <= 0) {
    actionPriority = "先补副项推荐时机，再看加钟和客单放大。";
  }

  return {
    levelLabel,
    tags,
    actionPriority,
  };
}

export function evaluateStoreBusinessScore(params: {
  revenueChange: number | null;
  clockEffectChange: number | null;
  groupbuy7dRevisitRate: number | null;
  groupbuy7dStoredValueConversionRate: number | null;
  groupbuyFirstOrderHighValueMemberRate: number | null;
  sleepingMemberRate: number | null;
  pointClockRate: number | null;
  addClockRate: number | null;
}): StoreBusinessSignal {
  const revenueChange = params.revenueChange ?? 0;
  const clockEffectChange = params.clockEffectChange ?? 0;
  const revisitRate = params.groupbuy7dRevisitRate ?? 1;
  const storedRate = params.groupbuy7dStoredValueConversionRate ?? 1;
  const highValueRate = params.groupbuyFirstOrderHighValueMemberRate ?? 0;
  const sleepingRate = params.sleepingMemberRate ?? 0;
  const pointClockRate = params.pointClockRate ?? 1;
  const addClockRate = params.addClockRate ?? 1;

  let levelLabel = "基本稳住";
  if (revenueChange <= -0.08 && clockEffectChange <= 0 && (revisitRate < 0.4 || sleepingRate >= 0.15)) {
    levelLabel = "高风险";
  } else if (
    storedRate < 0.2 ||
    revisitRate < 0.4 ||
    pointClockRate < 0.45 ||
    addClockRate < 0.3 ||
    highValueRate < 0.12
  ) {
    levelLabel = "承压";
  } else if (revenueChange >= 0 && highValueRate >= 0.25 && sleepingRate < 0.12) {
    levelLabel = "增长健康";
  }

  const tags = dedupeTags([
    storedRate < 0.2 ? "储值承接弱" : "",
    revisitRate < 0.4 ? "复到店偏弱" : "",
    pointClockRate < 0.45 ? "点钟偏弱" : "",
    addClockRate < 0.3 ? "加钟偏弱" : "",
    highValueRate < 0.12 ? "高价值沉淀慢" : highValueRate >= 0.25 ? "高价值沉淀好" : "",
    sleepingRate >= 0.15 ? "沉默会员偏高" : "",
  ]);
  if (tags.length === 0) {
    tags.push(levelLabel === "增长健康" ? "基本盘稳且转化在线" : "基本盘稳");
  }

  let actionPriority = "继续稳住基本盘，把好表现复制到高峰班次。";
  if (revisitRate < 0.4) {
    actionPriority = "先抓团购首单7天承接，别让二次到店继续流失。";
  } else if (storedRate < 0.2) {
    actionPriority = "先补前台和技师的开卡储值收口，再看高价值沉淀。";
  } else if (sleepingRate >= 0.15) {
    actionPriority = "先救高价值沉默会员，再做普通老客提醒。";
  } else if (pointClockRate < 0.45) {
    actionPriority = "先把高点钟技师放到高峰班，再补指定推荐。";
  } else if (addClockRate < 0.3) {
    actionPriority = "先统一加钟收口话术，把服务后半程抓紧。";
  }

  return {
    levelLabel,
    tags: tags.slice(0, 4),
    actionPriority,
  };
}
