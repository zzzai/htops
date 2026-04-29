import type {
  FiveStoreDailyOverviewCoreMetrics,
  FiveStoreDailyOverviewInput,
  FiveStoreDailyOverviewStoreSnapshot,
} from "./types.js";

type AggregateOverviewMetrics = {
  serviceRevenue: number;
  customerCount: number;
  serviceOrderCount: number;
  averageTicket: number | null;
  totalClockCount: number;
  pointClockRate: number | null;
  addClockRate: number | null;
  clockEffect: number;
  rechargeCash: number;
  storedConsumeAmount: number;
  memberPaymentAmount: number;
  effectiveMembers: number | null;
  newMembers: number | null;
  sleepingMembers: number | null;
  sleepingMemberRate: number | null;
  highBalanceSleepingMemberCount: number | null;
  highBalanceSleepingMemberAmount: number | null;
  firstChargeUnconsumedMemberCount: number | null;
  firstChargeUnconsumedMemberAmount: number | null;
  memberRepurchaseBaseCustomerCount7d: number | null;
  memberRepurchaseReturnedCustomerCount7d: number | null;
  memberRepurchaseRate7d: number | null;
};

type StructuralAsymmetryKind =
  | "none"
  | "revenue_up_traffic_down"
  | "traffic_up_revenue_down"
  | "quality_up_revenue_down"
  | "revenue_outpaces_traffic"
  | "traffic_outpaces_revenue";

type StoreInsight = {
  store: FiveStoreDailyOverviewStoreSnapshot;
  revenueChangePct: number | null;
  customerDelta: number | null;
  customerChangePct: number | null;
  orderDelta: number | null;
  averageTicketChangePct: number | null;
  pointDeltaPp: number | null;
  addDeltaPp: number | null;
  clockEffectChangePct: number | null;
  rechargeCashChangePct: number | null;
  storedConsumeChangePct: number | null;
  asymmetryKind: StructuralAsymmetryKind;
};

function trimTrailingZero(value: string): string {
  return value.replace(/\.0+$/u, "").replace(/(\.\d*[1-9])0+$/u, "$1");
}

function formatCurrency(value: number): string {
  if (Math.abs(value) >= 10_000) {
    return `${trimTrailingZero((value / 10_000).toFixed(2))}万`;
  }
  return `${trimTrailingZero(value.toFixed(0))}元`;
}

function formatCurrencyPrecise(value: number | null, digits = 1): string {
  if (value === null) {
    return "暂无";
  }
  return `${trimTrailingZero(value.toFixed(digits))}元`;
}

function formatCount(value: number): string {
  return trimTrailingZero(value.toFixed(0));
}

function formatPercent(value: number | null): string | null {
  if (value === null) {
    return null;
  }
  return `${trimTrailingZero((value * 100).toFixed(1))}%`;
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function resolveSleepingRate(metrics: Pick<
  FiveStoreDailyOverviewCoreMetrics,
  "sleepingMemberRate" | "sleepingMembers" | "effectiveMembers"
>): number | null {
  if (isFiniteNumber(metrics.sleepingMemberRate)) {
    return metrics.sleepingMemberRate;
  }
  if (isFiniteNumber(metrics.sleepingMembers) && isFiniteNumber(metrics.effectiveMembers) && metrics.effectiveMembers > 0) {
    return metrics.sleepingMembers / metrics.effectiveMembers;
  }
  return null;
}

function resolveRepurchaseRate(metrics: Pick<
  FiveStoreDailyOverviewCoreMetrics,
  | "memberRepurchaseRate7d"
  | "memberRepurchaseBaseCustomerCount7d"
  | "memberRepurchaseReturnedCustomerCount7d"
>): number | null {
  if (isFiniteNumber(metrics.memberRepurchaseRate7d)) {
    return metrics.memberRepurchaseRate7d;
  }
  if (
    isFiniteNumber(metrics.memberRepurchaseBaseCustomerCount7d) &&
    isFiniteNumber(metrics.memberRepurchaseReturnedCustomerCount7d) &&
    metrics.memberRepurchaseBaseCustomerCount7d > 0
  ) {
    return metrics.memberRepurchaseReturnedCustomerCount7d / metrics.memberRepurchaseBaseCustomerCount7d;
  }
  return null;
}

function percentChangeNumber(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || !Number.isFinite(previous) || previous <= 0) {
    return null;
  }
  return ((current - previous) / previous) * 100;
}

function percentPointDeltaNumber(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) {
    return null;
  }
  return (current - previous) * 100;
}

function formatSignedPercentValue(delta: number | null): string | null {
  if (delta === null) {
    return null;
  }
  if (Math.abs(delta) < 0.05) {
    return "持平";
  }
  return `${delta >= 0 ? "+" : ""}${trimTrailingZero(delta.toFixed(1))}%`;
}

function formatSignedCountValue(delta: number | null, unit: string): string | null {
  if (delta === null) {
    return null;
  }
  if (Math.abs(delta) < 0.5) {
    return "持平";
  }
  return `${delta >= 0 ? "+" : ""}${formatCount(delta)}${unit}`;
}

function formatSignedPpValue(delta: number | null): string | null {
  if (delta === null) {
    return null;
  }
  if (Math.abs(delta) < 0.05) {
    return "持平";
  }
  return `${delta >= 0 ? "+" : ""}${trimTrailingZero(delta.toFixed(1))}pp`;
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid] ?? null;
  }
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function topStoreByMetric(
  stores: FiveStoreDailyOverviewStoreSnapshot[],
  selector: (metrics: FiveStoreDailyOverviewCoreMetrics) => number | null,
): FiveStoreDailyOverviewStoreSnapshot | null {
  return (
    [...stores]
      .filter((store) => selector(store.current) !== null)
      .sort(
        (left, right) =>
          (selector(right.current) ?? Number.NEGATIVE_INFINITY) -
          (selector(left.current) ?? Number.NEGATIVE_INFINITY),
      )[0] ?? null
  );
}

function bottomStoreByMetric(
  stores: FiveStoreDailyOverviewStoreSnapshot[],
  selector: (metrics: FiveStoreDailyOverviewCoreMetrics) => number | null,
): FiveStoreDailyOverviewStoreSnapshot | null {
  return (
    [...stores]
      .filter((store) => selector(store.current) !== null)
      .sort(
        (left, right) =>
          (selector(left.current) ?? Number.POSITIVE_INFINITY) -
          (selector(right.current) ?? Number.POSITIVE_INFINITY),
      )[0] ?? null
  );
}

function aggregateOverviewMetrics(
  stores: FiveStoreDailyOverviewStoreSnapshot[],
  selector: (store: FiveStoreDailyOverviewStoreSnapshot) => FiveStoreDailyOverviewCoreMetrics | null,
): AggregateOverviewMetrics | null {
  let serviceRevenue = 0;
  let customerCount = 0;
  let serviceOrderCount = 0;
  let totalClockCount = 0;
  let pointClockNumerator = 0;
  let addClockNumerator = 0;
  let rechargeCash = 0;
  let storedConsumeAmount = 0;
  let memberPaymentAmount = 0;
  let effectiveMembers = 0;
  let newMembers = 0;
  let sleepingMembers = 0;
  let highBalanceSleepingMemberCount = 0;
  let highBalanceSleepingMemberAmount = 0;
  let firstChargeUnconsumedMemberCount = 0;
  let firstChargeUnconsumedMemberAmount = 0;
  let memberRepurchaseBaseCustomerCount7d = 0;
  let memberRepurchaseReturnedCustomerCount7d = 0;
  let hasPointClock = false;
  let hasAddClock = false;
  let comparableCount = 0;
  let memberStructureComplete = true;
  let memberRiskComplete = true;
  let memberRepurchaseComplete = true;

  for (const store of stores) {
    const metrics = selector(store);
    if (!metrics) {
      continue;
    }
    comparableCount += 1;
    serviceRevenue += metrics.serviceRevenue;
    customerCount += metrics.customerCount;
    serviceOrderCount += metrics.serviceOrderCount;
    totalClockCount += metrics.totalClockCount;
    rechargeCash += metrics.rechargeCash;
    storedConsumeAmount += metrics.storedConsumeAmount;
    memberPaymentAmount += metrics.memberPaymentAmount;
    const sleepingRate = resolveSleepingRate(metrics);
    if (
      isFiniteNumber(metrics.effectiveMembers) &&
      isFiniteNumber(metrics.newMembers) &&
      isFiniteNumber(metrics.sleepingMembers) &&
      sleepingRate !== null
    ) {
      effectiveMembers += metrics.effectiveMembers;
      newMembers += metrics.newMembers;
      sleepingMembers += metrics.sleepingMembers;
    } else {
      memberStructureComplete = false;
    }
    if (
      isFiniteNumber(metrics.highBalanceSleepingMemberCount) &&
      isFiniteNumber(metrics.highBalanceSleepingMemberAmount) &&
      isFiniteNumber(metrics.firstChargeUnconsumedMemberCount) &&
      isFiniteNumber(metrics.firstChargeUnconsumedMemberAmount)
    ) {
      highBalanceSleepingMemberCount += metrics.highBalanceSleepingMemberCount;
      highBalanceSleepingMemberAmount += metrics.highBalanceSleepingMemberAmount;
      firstChargeUnconsumedMemberCount += metrics.firstChargeUnconsumedMemberCount;
      firstChargeUnconsumedMemberAmount += metrics.firstChargeUnconsumedMemberAmount;
    } else {
      memberRiskComplete = false;
    }
    const repurchaseRate = resolveRepurchaseRate(metrics);
    if (
      isFiniteNumber(metrics.memberRepurchaseBaseCustomerCount7d) &&
      isFiniteNumber(metrics.memberRepurchaseReturnedCustomerCount7d) &&
      repurchaseRate !== null
    ) {
      memberRepurchaseBaseCustomerCount7d += metrics.memberRepurchaseBaseCustomerCount7d;
      memberRepurchaseReturnedCustomerCount7d += metrics.memberRepurchaseReturnedCustomerCount7d;
    } else {
      memberRepurchaseComplete = false;
    }
    if (metrics.pointClockRate !== null) {
      pointClockNumerator += metrics.pointClockRate * metrics.totalClockCount;
      hasPointClock = true;
    }
    if (metrics.addClockRate !== null) {
      addClockNumerator += metrics.addClockRate * metrics.totalClockCount;
      hasAddClock = true;
    }
  }

  if (comparableCount === 0) {
    return null;
  }

  return {
    serviceRevenue,
    customerCount,
    serviceOrderCount,
    averageTicket: customerCount > 0 ? serviceRevenue / customerCount : null,
    totalClockCount,
    pointClockRate: hasPointClock && totalClockCount > 0 ? pointClockNumerator / totalClockCount : null,
    addClockRate: hasAddClock && totalClockCount > 0 ? addClockNumerator / totalClockCount : null,
    clockEffect: totalClockCount > 0 ? serviceRevenue / totalClockCount : 0,
    rechargeCash,
    storedConsumeAmount,
    memberPaymentAmount,
    effectiveMembers: memberStructureComplete ? effectiveMembers : null,
    newMembers: memberStructureComplete ? newMembers : null,
    sleepingMembers: memberStructureComplete ? sleepingMembers : null,
    sleepingMemberRate:
      memberStructureComplete && effectiveMembers > 0 ? sleepingMembers / effectiveMembers : null,
    highBalanceSleepingMemberCount: memberRiskComplete ? highBalanceSleepingMemberCount : null,
    highBalanceSleepingMemberAmount: memberRiskComplete ? highBalanceSleepingMemberAmount : null,
    firstChargeUnconsumedMemberCount: memberRiskComplete ? firstChargeUnconsumedMemberCount : null,
    firstChargeUnconsumedMemberAmount: memberRiskComplete ? firstChargeUnconsumedMemberAmount : null,
    memberRepurchaseBaseCustomerCount7d: memberRepurchaseComplete ? memberRepurchaseBaseCustomerCount7d : null,
    memberRepurchaseReturnedCustomerCount7d: memberRepurchaseComplete
      ? memberRepurchaseReturnedCustomerCount7d
      : null,
    memberRepurchaseRate7d:
      memberRepurchaseComplete && memberRepurchaseBaseCustomerCount7d > 0
        ? memberRepurchaseReturnedCustomerCount7d / memberRepurchaseBaseCustomerCount7d
        : null,
  };
}

function resolveCommonGap(stores: FiveStoreDailyOverviewStoreSnapshot[]): {
  label: string;
  action: string;
  key: "add_clock" | "point_clock" | "clock_effect" | "customer_count";
} {
  const pointMedian = median(
    stores.map((store) => store.current.pointClockRate).filter((value): value is number => value !== null),
  );
  const addMedian = median(
    stores.map((store) => store.current.addClockRate).filter((value): value is number => value !== null),
  );
  const clockMedian = median(stores.map((store) => store.current.clockEffect));
  const customerMedian = median(stores.map((store) => store.current.customerCount));

  const weakPointCount = stores.filter(
    (store) =>
      pointMedian !== null &&
      store.current.pointClockRate !== null &&
      store.current.pointClockRate < pointMedian,
  ).length;
  const weakAddCount = stores.filter(
    (store) =>
      addMedian !== null &&
      store.current.addClockRate !== null &&
      store.current.addClockRate < addMedian,
  ).length;
  const weakClockEffectCount = stores.filter(
    (store) => clockMedian !== null && store.current.clockEffect < clockMedian,
  ).length;
  const weakCustomerCount = stores.filter(
    (store) => customerMedian !== null && store.current.customerCount < customerMedian,
  ).length;

  const ranked = [
    {
      key: "add_clock" as const,
      count: weakAddCount,
      label: "后半程加钟承接偏弱",
      action: "全店今天统一补服务后半程二次推荐，晚场先把加钟话术和收尾提醒做硬。",
    },
    {
      key: "point_clock" as const,
      count: weakPointCount,
      label: "指定承接偏弱",
      action: "前台和店长今天先盯指定技师承接，把强技师推荐前置到分单环节。",
    },
    {
      key: "clock_effect" as const,
      count: weakClockEffectCount,
      label: "钟效偏低",
      action: "今天先复盘低效班次和项目结构，减少低效时段空转。",
    },
    {
      key: "customer_count" as const,
      count: weakCustomerCount,
      label: "前端客流承接偏弱",
      action: "今天先补前端引流和高峰接待，把到店承接缺口补起来。",
    },
  ].sort((left, right) => right.count - left.count);

  return (
    ranked[0] ?? {
      key: "add_clock",
      label: "组合盘整体平稳",
      action: "今天继续盯盘量和承接质量，不做大幅动作切换。",
      count: 0,
    }
  );
}

function resolveSystemConstraintSentence(commonGap: ReturnType<typeof resolveCommonGap>): string {
  if (commonGap.key === "add_clock") {
    return "不是没人进店，而是进店后的后半程放大还不够硬。";
  }
  if (commonGap.key === "point_clock") {
    return "不是缺客户，而是强技师承接没有被前置到分单环节。";
  }
  if (commonGap.key === "clock_effect") {
    return "不是没有成交，而是单次服务价值还没被稳定拉开。";
  }
  return "不是后半程没有动作，而是前端进店盘子还没有被稳定补起来。";
}

function computeCopyScore(
  store: FiveStoreDailyOverviewStoreSnapshot,
  stores: FiveStoreDailyOverviewStoreSnapshot[],
): number {
  const revenueMedian = median(stores.map((entry) => entry.current.serviceRevenue));
  const pointMedian = median(
    stores.map((entry) => entry.current.pointClockRate).filter((value): value is number => value !== null),
  );
  const addMedian = median(
    stores.map((entry) => entry.current.addClockRate).filter((value): value is number => value !== null),
  );
  const clockMedian = median(stores.map((entry) => entry.current.clockEffect));

  return (
    store.current.serviceRevenue / Math.max(revenueMedian ?? 1, 1) +
    (store.current.pointClockRate ?? pointMedian ?? 0) / Math.max(pointMedian ?? 0.01, 0.01) +
    (store.current.addClockRate ?? addMedian ?? 0) / Math.max(addMedian ?? 0.01, 0.01) +
    store.current.clockEffect / Math.max(clockMedian ?? 1, 1)
  );
}

function resolveCopyStore(
  stores: FiveStoreDailyOverviewStoreSnapshot[],
): FiveStoreDailyOverviewStoreSnapshot | null {
  return (
    [...stores].sort(
      (left, right) => computeCopyScore(right, stores) - computeCopyScore(left, stores),
    )[0] ?? null
  );
}

function computeRepairScore(
  store: FiveStoreDailyOverviewStoreSnapshot,
  stores: FiveStoreDailyOverviewStoreSnapshot[],
): number {
  const pointMedian = median(
    stores.map((entry) => entry.current.pointClockRate).filter((value): value is number => value !== null),
  );
  const addMedian = median(
    stores.map((entry) => entry.current.addClockRate).filter((value): value is number => value !== null),
  );
  const clockMedian = median(stores.map((entry) => entry.current.clockEffect));
  const customerMedian = median(stores.map((entry) => entry.current.customerCount));

  return (
    (store.current.pointClockRate ?? pointMedian ?? 0) / Math.max(pointMedian ?? 0.01, 0.01) +
    (store.current.addClockRate ?? addMedian ?? 0) / Math.max(addMedian ?? 0.01, 0.01) +
    store.current.clockEffect / Math.max(clockMedian ?? 1, 1) +
    store.current.customerCount / Math.max(customerMedian ?? 1, 1)
  );
}

function resolveRepairStore(
  stores: FiveStoreDailyOverviewStoreSnapshot[],
): FiveStoreDailyOverviewStoreSnapshot | null {
  return (
    [...stores].sort(
      (left, right) => computeRepairScore(left, stores) - computeRepairScore(right, stores),
    )[0] ?? null
  );
}

function resolveStoreGapLabel(
  store: FiveStoreDailyOverviewStoreSnapshot,
  stores: FiveStoreDailyOverviewStoreSnapshot[],
): string {
  const customerMedian = median(stores.map((entry) => entry.current.customerCount));
  const pointMedian = median(
    stores.map((entry) => entry.current.pointClockRate).filter((value): value is number => value !== null),
  );
  const addMedian = median(
    stores.map((entry) => entry.current.addClockRate).filter((value): value is number => value !== null),
  );
  const clockMedian = median(stores.map((entry) => entry.current.clockEffect));

  if (
    customerMedian !== null &&
    store.current.customerCount >= customerMedian &&
    addMedian !== null &&
    store.current.addClockRate !== null &&
    store.current.addClockRate < addMedian
  ) {
    return "客流不差，但后半程加钟承接偏弱";
  }
  if (
    clockMedian !== null &&
    store.current.clockEffect < clockMedian &&
    addMedian !== null &&
    store.current.addClockRate !== null &&
    store.current.addClockRate < addMedian
  ) {
    return "钟效和后半程承接都偏弱，单次服务价值没有拉开";
  }
  if (
    customerMedian !== null &&
    store.current.customerCount < customerMedian &&
    pointMedian !== null &&
    store.current.pointClockRate !== null &&
    store.current.pointClockRate >= pointMedian
  ) {
    return "质量不差，主要还差量盘放大";
  }
  if (
    pointMedian !== null &&
    store.current.pointClockRate !== null &&
    store.current.pointClockRate >= pointMedian &&
    addMedian !== null &&
    store.current.addClockRate !== null &&
    store.current.addClockRate < addMedian
  ) {
    return "前半程指定不差，但后半程承接没有接上";
  }
  if (customerMedian !== null && store.current.customerCount < customerMedian) {
    return "前端客流承接仍偏弱";
  }
  return "盘子和结构都需继续盯住";
}

function resolveCopyStoreLabel(
  store: FiveStoreDailyOverviewStoreSnapshot,
  stores: FiveStoreDailyOverviewStoreSnapshot[],
): string {
  const clockLeader = topStoreByMetric(stores, (metrics) => metrics.clockEffect);
  const addLeader = topStoreByMetric(stores, (metrics) => metrics.addClockRate);
  if (clockLeader?.orgId === store.orgId && addLeader?.orgId === store.orgId) {
    return "昨天既把单钟产出拉开，也把后半程承接接住了。";
  }
  if (clockLeader?.orgId === store.orgId) {
    return "昨天更像靠更强承接效率把结果做出来，值得复盘高效承接打法。";
  }
  return "昨天不是单点偶发，而是量盘放大后承接也跟上了。";
}

function resolveStructuralAsymmetryKind(params: {
  revenueChangePct: number | null;
  customerDelta: number | null;
  customerChangePct: number | null;
  pointDeltaPp: number | null;
  addDeltaPp: number | null;
}): StructuralAsymmetryKind {
  if (params.revenueChangePct === null || params.customerDelta === null) {
    return "none";
  }
  if (params.revenueChangePct >= 3 && params.customerDelta < 0) {
    return "revenue_up_traffic_down";
  }
  if (params.revenueChangePct <= 0 && params.customerDelta > 0) {
    return "traffic_up_revenue_down";
  }
  if (
    params.revenueChangePct <= -3 &&
    ((params.pointDeltaPp ?? 0) >= 0.5 || (params.addDeltaPp ?? 0) >= 0.5)
  ) {
    return "quality_up_revenue_down";
  }
  if (
    params.customerChangePct !== null &&
    params.revenueChangePct - params.customerChangePct >= 4
  ) {
    return "revenue_outpaces_traffic";
  }
  if (
    params.customerChangePct !== null &&
    params.customerChangePct - params.revenueChangePct >= 4
  ) {
    return "traffic_outpaces_revenue";
  }
  return "none";
}

function buildStoreInsights(
  stores: FiveStoreDailyOverviewStoreSnapshot[],
): StoreInsight[] {
  return stores.map((store) => {
    const baseline = store.previousWeekSameDay;
    const revenueChangePct = baseline
      ? percentChangeNumber(store.current.serviceRevenue, baseline.serviceRevenue)
      : null;
    const customerDelta = baseline ? store.current.customerCount - baseline.customerCount : null;
    const customerChangePct = baseline
      ? percentChangeNumber(store.current.customerCount, baseline.customerCount)
      : null;
    const orderDelta = baseline ? store.current.serviceOrderCount - baseline.serviceOrderCount : null;
    const averageTicketChangePct = baseline
      ? percentChangeNumber(store.current.averageTicket, baseline.averageTicket)
      : null;
    const pointDeltaPp = baseline
      ? percentPointDeltaNumber(store.current.pointClockRate, baseline.pointClockRate)
      : null;
    const addDeltaPp = baseline
      ? percentPointDeltaNumber(store.current.addClockRate, baseline.addClockRate)
      : null;
    const clockEffectChangePct = baseline
      ? percentChangeNumber(store.current.clockEffect, baseline.clockEffect)
      : null;
    const rechargeCashChangePct = baseline
      ? percentChangeNumber(store.current.rechargeCash, baseline.rechargeCash)
      : null;
    const storedConsumeChangePct = baseline
      ? percentChangeNumber(store.current.storedConsumeAmount, baseline.storedConsumeAmount)
      : null;

    return {
      store,
      revenueChangePct,
      customerDelta,
      customerChangePct,
      orderDelta,
      averageTicketChangePct,
      pointDeltaPp,
      addDeltaPp,
      clockEffectChangePct,
      rechargeCashChangePct,
      storedConsumeChangePct,
      asymmetryKind: resolveStructuralAsymmetryKind({
        revenueChangePct,
        customerDelta,
        customerChangePct,
        pointDeltaPp,
        addDeltaPp,
      }),
    };
  });
}

function buildEmptyAggregateOverviewMetrics(): AggregateOverviewMetrics {
  return {
    serviceRevenue: 0,
    customerCount: 0,
    serviceOrderCount: 0,
    averageTicket: null,
    totalClockCount: 0,
    pointClockRate: null,
    addClockRate: null,
    clockEffect: 0,
    rechargeCash: 0,
    storedConsumeAmount: 0,
    memberPaymentAmount: 0,
    effectiveMembers: null,
    newMembers: null,
    sleepingMembers: null,
    sleepingMemberRate: null,
    highBalanceSleepingMemberCount: null,
    highBalanceSleepingMemberAmount: null,
    firstChargeUnconsumedMemberCount: null,
    firstChargeUnconsumedMemberAmount: null,
    memberRepurchaseBaseCustomerCount7d: null,
    memberRepurchaseReturnedCustomerCount7d: null,
    memberRepurchaseRate7d: null,
  };
}

function buildSummaryJudgment(params: {
  currentAggregate: AggregateOverviewMetrics;
  baselineAggregate: AggregateOverviewMetrics | null;
  commonGap: ReturnType<typeof resolveCommonGap>;
}): string {
  if (!params.baselineAggregate) {
    return `昨天先看稳定事实，最该继续盯住的仍是${params.commonGap.label}。`;
  }

  const revenueChange = percentChangeNumber(
    params.currentAggregate.serviceRevenue,
    params.baselineAggregate.serviceRevenue,
  );
  const customerDelta = params.currentAggregate.customerCount - params.baselineAggregate.customerCount;
  const clockEffectChange = percentChangeNumber(
    params.currentAggregate.clockEffect,
    params.baselineAggregate.clockEffect,
  );

  if ((revenueChange ?? 0) >= 0 && customerDelta < 0 && (clockEffectChange ?? 0) <= 0) {
    return "昨天 5 店不是在真正增长，而是在用更多供给，暂时托住更弱的前端流量。";
  }
  if ((revenueChange ?? 0) >= 0 && customerDelta < 0) {
    return "昨天 5 店结果没有掉下来，但增长更像效率托底，不像系统已经升级完成。";
  }
  if ((revenueChange ?? 0) > 0 && customerDelta >= 0) {
    return "昨天 5 店有增长，但还不是系统性增长，更像局部修复开始起效。";
  }
  if ((revenueChange ?? 0) < 0 && customerDelta > 0) {
    return "昨天 5 店不是没人来，而是来的客人没有被足够有效地放大。";
  }
  return "昨天 5 店前端量盘和后端承接都在承压，系统升级还没真正完成。";
}

function buildSummaryLines(params: {
  currentAggregate: AggregateOverviewMetrics;
  baselineAggregate: AggregateOverviewMetrics | null;
  commonGap: ReturnType<typeof resolveCommonGap>;
}): string[] {
  const revenueChange = params.baselineAggregate
    ? percentChangeNumber(
        params.currentAggregate.serviceRevenue,
        params.baselineAggregate.serviceRevenue,
      )
    : null;
  const customerDelta = params.baselineAggregate
    ? params.currentAggregate.customerCount - params.baselineAggregate.customerCount
    : null;
  const orderDelta = params.baselineAggregate
    ? params.currentAggregate.serviceOrderCount - params.baselineAggregate.serviceOrderCount
    : null;
  const clockEffectChange = params.baselineAggregate
    ? percentChangeNumber(params.currentAggregate.clockEffect, params.baselineAggregate.clockEffect)
    : null;

  return params.baselineAggregate
    ? [
        `- 判断：${buildSummaryJudgment(params)}`,
        `- 营收：${formatCurrency(params.currentAggregate.serviceRevenue)}（较上周同期 ${formatSignedPercentValue(revenueChange) ?? "持平"}）`,
        `- 客流：${formatCount(params.currentAggregate.customerCount)}人（较上周 ${formatSignedCountValue(customerDelta, "人") ?? "持平"}）`,
        `- 单数：${formatCount(params.currentAggregate.serviceOrderCount)}单（较上周 ${formatSignedCountValue(orderDelta, "单") ?? "持平"}）`,
        `- 单钟产出：${formatCurrencyPrecise(params.currentAggregate.clockEffect)}/钟（较上周 ${formatSignedPercentValue(clockEffectChange) ?? "持平"}）`,
        "- 结论：这几个信号一起出现，说明问题已经不是单店波动，而是系统还没有完成升级。",
      ]
    : [
        `- 判断：${buildSummaryJudgment(params)}`,
        `- 营收：${formatCurrency(params.currentAggregate.serviceRevenue)}`,
        `- 客流：${formatCount(params.currentAggregate.customerCount)}人`,
        `- 单数：${formatCount(params.currentAggregate.serviceOrderCount)}单`,
        `- 单钟产出：${formatCurrencyPrecise(params.currentAggregate.clockEffect)}/钟`,
        "- 结论：当前先按稳定事实盯盘，暂不下对比结论。",
      ];
}

function buildEvidenceLabels(params: {
  customerDelta: number | null;
  pointDeltaPp: number | null;
  addDeltaPp: number | null;
  clockEffectChangePct: number | null;
}): {
  front: string;
  middle: string;
  back: string;
} {
  const front =
    params.customerDelta === null
      ? "前端情况待补充。"
      : params.customerDelta < 0
        ? "前端变弱了。"
        : params.customerDelta > 0
          ? "前端有改善，但新增势能还不够大。"
          : "前端没有变强。";
  const middle =
    params.pointDeltaPp === null
      ? "中段承接情况待补充。"
      : params.pointDeltaPp <= 0.05
        ? "中段承接没有变强。"
        : "中段承接在修，但还没形成决定性优势。";
  const back =
    params.addDeltaPp === null
      ? "后段情况待补充。"
      : params.addDeltaPp > 0.05 && (params.clockEffectChangePct ?? 0) <= 0.5
        ? "后段虽然在补，但补得还不够。"
        : params.addDeltaPp > 0.05
          ? "后段在补，但价值放大还没有完全拉开。"
          : "后段还没有被稳定补起来。";
  return { front, middle, back };
}

function buildEvidenceLines(params: {
  currentAggregate: AggregateOverviewMetrics;
  baselineAggregate: AggregateOverviewMetrics | null;
}): string[] {
  if (!params.baselineAggregate) {
    return ["当前缺少上周同期对照，本版先不展开证据链。"];
  }

  const revenueChange = percentChangeNumber(
    params.currentAggregate.serviceRevenue,
    params.baselineAggregate.serviceRevenue,
  );
  const customerDelta = params.currentAggregate.customerCount - params.baselineAggregate.customerCount;
  const orderDelta = params.currentAggregate.serviceOrderCount - params.baselineAggregate.serviceOrderCount;
  const pointDeltaPp = percentPointDeltaNumber(
    params.currentAggregate.pointClockRate,
    params.baselineAggregate.pointClockRate,
  );
  const addDeltaPp = percentPointDeltaNumber(
    params.currentAggregate.addClockRate,
    params.baselineAggregate.addClockRate,
  );
  const clockEffectChangePct = percentChangeNumber(
    params.currentAggregate.clockEffect,
    params.baselineAggregate.clockEffect,
  );
  const extraClocks = params.currentAggregate.totalClockCount - params.baselineAggregate.totalClockCount;
  const labels = buildEvidenceLabels({
    customerDelta,
    pointDeltaPp,
    addDeltaPp,
    clockEffectChangePct,
  });

  const lines = [
    "1. 前端",
    `- 判断：${labels.front}`,
    `- 客流：${formatSignedCountValue(customerDelta, "人") ?? "持平"}；单数：${formatSignedCountValue(orderDelta, "单") ?? "持平"}`,
    `- 说明：进店盘子${customerDelta !== null && customerDelta > 0 ? "有所修复" : customerDelta !== null && customerDelta < 0 ? "真实收缩" : "没有明显扩大"}。`,
    "",
    "2. 中段承接",
    `- 判断：${labels.middle}`,
    `- 点钟率：${formatPercent(params.currentAggregate.pointClockRate) ?? "暂无"}（较上周 ${formatSignedPpValue(pointDeltaPp) ?? "持平"}）`,
    `- 说明：顾客对更高价值服务的主动选择${(pointDeltaPp ?? 0) > 0.05 ? "在修" : "没有变强"}。`,
    "",
    "3. 后段",
    `- 判断：${labels.back}`,
    `- 加钟率：${formatPercent(params.currentAggregate.addClockRate) ?? "暂无"}（较上周 ${formatSignedPpValue(addDeltaPp) ?? "持平"}）`,
    `- 单钟产出：${formatSignedPercentValue(clockEffectChangePct) ?? "持平"}`,
    `- 说明：服务时长和后半程动作${(addDeltaPp ?? 0) > 0.05 ? "在被拉起" : "还没被拉起"}，但价值放大还没有同步跟上。`,
  ];

  if (extraClocks > 0.5) {
    lines.push(
      "",
      "4. 推断",
      `- 总钟变化：5 店昨天较上周同期大约多消耗了 ${formatCount(extraClocks)} 个钟。`,
      `- 营收变化：${formatSignedPercentValue(revenueChange) ?? "持平"}`,
      `- 结论：${
        (clockEffectChangePct ?? 0) <= 0
          ? "这不是效率升级，更像供给侧在替系统问题买单。"
          : "这说明团队已经在补供给，但系统增益还没有被稳定放大。"
      }`,
    );
  }

  return lines;
}

function hasCompleteMemberSignals(metrics: AggregateOverviewMetrics): boolean {
  return (
    metrics.memberRepurchaseRate7d !== null &&
    metrics.memberRepurchaseBaseCustomerCount7d !== null &&
    metrics.memberRepurchaseReturnedCustomerCount7d !== null &&
    metrics.firstChargeUnconsumedMemberCount !== null &&
    metrics.firstChargeUnconsumedMemberAmount !== null
  );
}

function resolveWeakestLink(params: {
  currentAggregate: AggregateOverviewMetrics;
  baselineAggregate: AggregateOverviewMetrics | null;
  commonGap: ReturnType<typeof resolveCommonGap>;
}): string {
  const rechargeDelta = params.baselineAggregate
    ? percentChangeNumber(
        params.currentAggregate.rechargeCash,
        params.baselineAggregate.rechargeCash,
      )
    : null;
  const revenueDelta = params.baselineAggregate
    ? percentChangeNumber(
        params.currentAggregate.serviceRevenue,
        params.baselineAggregate.serviceRevenue,
      )
    : null;
  const storedConsumeDelta = params.baselineAggregate
    ? percentChangeNumber(
        params.currentAggregate.storedConsumeAmount,
        params.baselineAggregate.storedConsumeAmount,
      )
    : null;

  if (
    hasCompleteMemberSignals(params.currentAggregate) &&
    (params.currentAggregate.firstChargeUnconsumedMemberCount ?? 0) > 0 &&
    (rechargeDelta ?? Number.NEGATIVE_INFINITY) >= (revenueDelta ?? Number.NEGATIVE_INFINITY) &&
    (rechargeDelta ?? Number.NEGATIVE_INFINITY) >= (storedConsumeDelta ?? Number.NEGATIVE_INFINITY)
  ) {
    return "储值后的首耗激活";
  }
  if (params.commonGap.key === "add_clock") {
    return "后半程加钟放大";
  }
  if (params.commonGap.key === "point_clock") {
    return "指定承接";
  }
  if (params.commonGap.key === "clock_effect") {
    return "单次服务价值放大";
  }
  return "前端进店盘";
}

function buildCoreProblemLines(params: {
  currentAggregate: AggregateOverviewMetrics;
  baselineAggregate: AggregateOverviewMetrics | null;
  commonGap: ReturnType<typeof resolveCommonGap>;
}): string[] {
  const weakestLink = resolveWeakestLink(params);
  const customerDelta = params.baselineAggregate
    ? params.currentAggregate.customerCount - params.baselineAggregate.customerCount
    : null;
  const pointDeltaPp = params.baselineAggregate
    ? percentPointDeltaNumber(
        params.currentAggregate.pointClockRate,
        params.baselineAggregate.pointClockRate,
      )
    : null;
  const addDeltaPp = params.baselineAggregate
    ? percentPointDeltaNumber(
        params.currentAggregate.addClockRate,
        params.baselineAggregate.addClockRate,
      )
    : null;

  const frontSegment =
    customerDelta === null ? "前端进店还待继续观察" : customerDelta < 0 ? "前端进店在变弱" : "前端进店在修复";
  const middleSegment =
    pointDeltaPp === null ? "指定承接待补充" : pointDeltaPp <= 0.05 ? "指定没有变强" : "指定在修";
  const backSegment =
    addDeltaPp === null ? "后半程加钟待补充" : addDeltaPp > 0.05 ? "后半程加钟在补" : "后半程加钟还没补起来";

  const lines = [
    "- 判断：真正的核心问题不是“哪家店最差”，而是 5 店还没有形成一套稳定的价值放大系统。",
    "",
    "- 链路：进店 -> 指定 -> 加钟 -> 储值 -> 首耗 -> 复购",
    "",
    `- 现状：${frontSegment}，${middleSegment}，${backSegment}。`,
    `- 最薄一环：${weakestLink}`,
    "",
  ];

  if (weakestLink === "储值后的首耗激活") {
    lines.push("- 解释：钱进来了，但系统还没有足够快地把这笔钱变成下一次真实服务。");
  } else if (weakestLink === "后半程加钟放大") {
    lines.push("- 解释：人进来了，但服务价值还没有被稳定放大。");
  } else if (weakestLink === "指定承接") {
    lines.push("- 解释：顾客愿意来，但更高价值的选择还没有被稳定接住。");
  } else {
    lines.push("- 解释：系统还在局部修，而不是把整条链路打通。");
  }

  return lines;
}

function buildMemberSignalLines(params: {
  currentAggregate: AggregateOverviewMetrics;
  baselineAggregate: AggregateOverviewMetrics | null;
}): string[] {
  if (!hasCompleteMemberSignals(params.currentAggregate)) {
    return ["当前会员链路关键字段还不完整，本版不下激活与复购结论。"];
  }

  const revenueChange = params.baselineAggregate
    ? percentChangeNumber(
        params.currentAggregate.serviceRevenue,
        params.baselineAggregate.serviceRevenue,
      )
    : null;
  const rechargeChange = params.baselineAggregate
    ? percentChangeNumber(params.currentAggregate.rechargeCash, params.baselineAggregate.rechargeCash)
    : null;
  const storedConsumeChange = params.baselineAggregate
    ? percentChangeNumber(
        params.currentAggregate.storedConsumeAmount,
        params.baselineAggregate.storedConsumeAmount,
      )
    : null;
  const sampleSize = params.currentAggregate.memberRepurchaseBaseCustomerCount7d ?? 0;

  return [
    params.baselineAggregate
      ? `- 储值现金：${formatSignedPercentValue(rechargeChange) ?? "持平"}，${rechargeChange !== null && revenueChange !== null && storedConsumeChange !== null ? `明显${rechargeChange >= revenueChange && rechargeChange >= storedConsumeChange ? "强于" : "弱于"}营收 ${formatSignedPercentValue(revenueChange) ?? "持平"} 和耗卡 ${formatSignedPercentValue(storedConsumeChange) ?? "持平"}` : "先按稳定事实看"}。`
      : `- 储值现金：${formatCurrency(params.currentAggregate.rechargeCash)}；耗卡：${formatCurrency(params.currentAggregate.storedConsumeAmount)}。`,
    `- 首充未耗卡：${formatCount(params.currentAggregate.firstChargeUnconsumedMemberCount ?? 0)}人 / ${formatCurrency(params.currentAggregate.firstChargeUnconsumedMemberAmount ?? 0)}，是当前最该警惕的隐藏积压。`,
    `- 7日复购率：${formatPercent(params.currentAggregate.memberRepurchaseRate7d) ?? "暂无"}（${formatCount(params.currentAggregate.memberRepurchaseReturnedCustomerCount7d ?? 0)}/${formatCount(params.currentAggregate.memberRepurchaseBaseCustomerCount7d ?? 0)}）。`,
    `- 判断：${sampleSize <= 30 ? "这条样本还不大，但已经足够说明一个方向：" : "这条链路已经给出一个很清楚的方向："}`,
    "- 结论：问题不是客户不肯付钱，问题是付完钱之后，没有被足够快地带入下一次服务。",
    "",
    "这不是销售问题，这是激活问题。",
  ];
}

type StoreRoleKind =
  | "拉量样板"
  | "首耗激活样板店"
  | "结果主力店"
  | "承接修复店"
  | "量盘修复店"
  | "结构修复店";

type StoreRoleAssignment = {
  role: StoreRoleKind;
  problem: string;
  action: string;
};

function pickVolumeSample(insights: StoreInsight[]): StoreInsight | null {
  return (
    [...insights]
      .sort(
        (left, right) =>
          (right.customerDelta ?? Number.NEGATIVE_INFINITY) - (left.customerDelta ?? Number.NEGATIVE_INFINITY) ||
          (right.revenueChangePct ?? Number.NEGATIVE_INFINITY) -
            (left.revenueChangePct ?? Number.NEGATIVE_INFINITY),
      )[0] ?? null
  );
}

function pickActivationSample(stores: FiveStoreDailyOverviewStoreSnapshot[]): FiveStoreDailyOverviewStoreSnapshot | null {
  return topStoreByMetric(stores, (metrics) => metrics.firstChargeUnconsumedMemberCount ?? null);
}

function pickRevenueAnchor(
  stores: FiveStoreDailyOverviewStoreSnapshot[],
  excludeOrgIds: Set<string>,
): FiveStoreDailyOverviewStoreSnapshot | null {
  return (
    [...stores]
      .filter((store) => !excludeOrgIds.has(store.orgId))
      .sort((left, right) => right.current.serviceRevenue - left.current.serviceRevenue)[0] ?? null
  );
}

function pickRepairStore(
  insights: StoreInsight[],
  excludeOrgIds: Set<string>,
): StoreInsight | null {
  const qualityRepair = [...insights]
    .filter(
      (insight) =>
        !excludeOrgIds.has(insight.store.orgId) &&
        (insight.asymmetryKind === "quality_up_revenue_down" ||
          ((insight.revenueChangePct ?? 0) < 0 &&
            ((insight.pointDeltaPp ?? 0) > 0.05 || (insight.addDeltaPp ?? 0) > 0.05))),
    )
    .sort((left, right) => (left.revenueChangePct ?? 0) - (right.revenueChangePct ?? 0));
  if (qualityRepair[0]) {
    return qualityRepair[0];
  }

  return (
    [...insights]
      .filter((insight) => !excludeOrgIds.has(insight.store.orgId))
      .sort(
        (left, right) =>
          (left.addDeltaPp ?? Number.POSITIVE_INFINITY) - (right.addDeltaPp ?? Number.POSITIVE_INFINITY) ||
          (left.revenueChangePct ?? Number.POSITIVE_INFINITY) -
            (right.revenueChangePct ?? Number.POSITIVE_INFINITY),
      )[0] ?? null
  );
}

function pickTrafficRepairStore(
  insights: StoreInsight[],
  excludeOrgIds: Set<string>,
): StoreInsight | null {
  return (
    [...insights]
      .filter((insight) => !excludeOrgIds.has(insight.store.orgId))
      .sort(
        (left, right) =>
          left.store.current.customerCount - right.store.current.customerCount ||
          (left.customerDelta ?? Number.POSITIVE_INFINITY) - (right.customerDelta ?? Number.POSITIVE_INFINITY),
      )[0] ?? null
  );
}

function buildStoreRoleAssignments(params: {
  stores: FiveStoreDailyOverviewStoreSnapshot[];
  insights: StoreInsight[];
}): Map<string, StoreRoleAssignment> {
  const assignments = new Map<string, StoreRoleAssignment>();
  const reservedOrgIds = new Set<string>();

  const volumeSample = pickVolumeSample(params.insights);
  if (volumeSample) {
    assignments.set(volumeSample.store.orgId, {
      role: "拉量样板",
      problem: "进店后的价值放大还没完全接住",
      action: "把接待、分单、收尾 SOP 当天拆出来复制。",
    });
    reservedOrgIds.add(volumeSample.store.orgId);
  }

  const activationSample = pickActivationSample(params.stores);
  if (activationSample && !reservedOrgIds.has(activationSample.orgId)) {
    assignments.set(activationSample.orgId, {
      role: "首耗激活样板店",
      problem: "会员链路里的隐藏积压更值得优先拆",
      action: "把“充值后 48 小时首耗激活”先跑成样板。",
    });
    reservedOrgIds.add(activationSample.orgId);
  }

  const revenueAnchor = pickRevenueAnchor(params.stores, reservedOrgIds);
  if (revenueAnchor) {
    assignments.set(revenueAnchor.orgId, {
      role: "结果主力店",
      problem: "不能继续只靠单店硬撑",
      action: "把现有承接打法模块化，而不是继续依赖单店自然托底。",
    });
    reservedOrgIds.add(revenueAnchor.orgId);
  }

  const repairStore = pickRepairStore(params.insights, reservedOrgIds);
  if (repairStore) {
    assignments.set(repairStore.store.orgId, {
      role: "承接修复店",
      problem: "前端承接和进店盘子偏弱，量盘回落吞掉了改善",
      action: "先抓高峰接待和进店转化。",
    });
    reservedOrgIds.add(repairStore.store.orgId);
  }

  const trafficRepairStore = pickTrafficRepairStore(params.insights, reservedOrgIds);
  if (trafficRepairStore) {
    assignments.set(trafficRepairStore.store.orgId, {
      role: "量盘修复店",
      problem: "前端进店不足，单靠后半程补动作很难把结果真正拉回来",
      action: "先把前端到店盘子稳住。",
    });
    reservedOrgIds.add(trafficRepairStore.store.orgId);
  }

  for (const store of params.stores) {
    if (assignments.has(store.orgId)) {
      continue;
    }
    assignments.set(store.orgId, {
      role: "结构修复店",
      problem: resolveStoreGapLabel(store, params.stores),
      action: "先把关键承接动作稳定下来。",
    });
  }

  return assignments;
}

function buildStoreJudgmentLines(params: {
  stores: FiveStoreDailyOverviewStoreSnapshot[];
  insights: StoreInsight[];
}): string[] {
  const assignments = buildStoreRoleAssignments(params);

  return params.stores.flatMap((store) => {
    const assignment = assignments.get(store.orgId);
    return [
      `### ${store.storeName}`,
      `- 角色：${assignment?.role ?? "结构修复店"}`,
      `- 问题：${assignment?.problem ?? "链路还不够稳"}`,
      `- 动作：${assignment?.action ?? "先把关键动作做稳。"}`,
      "",
    ];
  });
}

function buildSinglePriorityActionLines(params: {
  currentAggregate: AggregateOverviewMetrics;
  commonGap: ReturnType<typeof resolveCommonGap>;
}): string[] {
  if (
    params.currentAggregate.firstChargeUnconsumedMemberCount !== null &&
    params.currentAggregate.firstChargeUnconsumedMemberCount > 0
  ) {
    return [
      "- 今天不要再把重点只放在“加钟话术”上。",
      "- 真正最值钱的一刀是：",
      "",
      "1. 把昨天新增储值但尚未首耗的会员，全部拉出名单。",
      "2. 按门店和责任人分配。",
      "3. 48 小时内完成首耗激活。",
      "",
      "- 原因：",
      "这批人已经完成了最难的一步，就是愿意付钱。",
      "如果这一步还不能转成真实服务，系统后面就会越来越依赖拉新、前台硬撑和供给透支。",
      "",
      "- 建议今天开始直接盯一个结果指标：",
      "48小时首耗激活完成率。",
      "",
      "这才是昨天数据真正指向的核心问题。",
    ];
  }

  return [
    "- 今天如果只做一件事，就不要再分散动作。",
    `- 直接围绕“${params.commonGap.label}”下手。`,
    `- 动作：${normalizeGroupAction(params.commonGap.action)}`,
  ];
}

function normalizeGroupAction(action: string): string {
  return action.replace(/^全店/u, "").trim();
}

export function renderFiveStoreDailyOverview(params: FiveStoreDailyOverviewInput): string {
  const currentAggregate =
    aggregateOverviewMetrics(params.stores, (store) => store.current) ??
    buildEmptyAggregateOverviewMetrics();
  const baselineAggregate = aggregateOverviewMetrics(
    params.stores,
    (store) => store.previousWeekSameDay ?? null,
  );
  const commonGap = resolveCommonGap(params.stores);
  const insights = buildStoreInsights(params.stores);

  const sections = [
    "# 荷塘悦色5店昨日经营总览",
    `日期：${params.bizDate}`,
    ...(params.baselineBizDate ? [`对比：${params.baselineBizDate}`] : []),
    ...(params.backgroundHint ? [`背景提示：${params.backgroundHint}`] : []),
    "",
    "## 一、总判断",
    ...buildSummaryLines({
      currentAggregate,
      baselineAggregate,
      commonGap,
    }),
    "",
    "## 二、证据链",
    ...buildEvidenceLines({
      currentAggregate,
      baselineAggregate,
    }),
    "",
    "## 三、真正的核心问题",
    ...buildCoreProblemLines({
      currentAggregate,
      baselineAggregate,
      commonGap,
    }),
    "",
    "## 四、最值得警惕的会员信号",
    ...buildMemberSignalLines({
      currentAggregate,
      baselineAggregate,
    }),
    "",
    "## 五、门店级判断",
    ...buildStoreJudgmentLines({
      stores: params.stores,
      insights,
    }),
    "## 六、如果今天只做一件事",
    ...buildSinglePriorityActionLines({
      currentAggregate,
      commonGap,
    }),
  ];

  return sections.join("\n");
}
