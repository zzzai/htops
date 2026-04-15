import { evaluateStoreBusinessScore } from "./business-score.js";
import { HetangOpsStore } from "./store.js";
import type {
  DailyStoreAlert,
  DailyGroupbuyPlatformMetric,
  DailyStoreMetrics,
  TechCurrentRecord,
  TechUpClockRecord,
} from "./types.js";

type ClockBucket = "queue" | "selected" | "point" | "add";
type AttendanceBucket = "strength" | "star" | "spa" | "ear" | "small";
type ServiceBucket = "main" | "spa" | "ear" | "small";
type PerformerBucket = "strength" | "star";

type ClockBreakdown = {
  queue: number;
  selected: number;
  point: number;
  add: number;
  subtotal: number;
};

type AttendanceSummary = {
  strength: number;
  star: number;
  spa: number;
  ear: number;
  small: number;
  total: number;
};

type StoreManagerDailyDetail = {
  attendance: AttendanceSummary;
  strengthMain: ClockBreakdown;
  starMain: ClockBreakdown;
  strengthSpa: ClockBreakdown;
  starSpa: ClockBreakdown;
  earClockCount: number;
  smallClockCount: number;
  mainClockCount: number;
  totalRevenue: number;
  actualRevenue: number;
  cashPerformance: number;
};

type ActionCandidateCategory =
  | "data"
  | "staffing"
  | "groupbuy"
  | "member"
  | "onsite"
  | "finance"
  | "fallback";

type ActionCandidate = {
  category: ActionCandidateCategory;
  score: number;
  title: string;
  target: string;
  action: string;
  standard: string;
};

type CurrentTechItem = {
  itemName?: string;
  itemTypeName?: string;
  itemCategory?: number;
};

type CurrentTechProfile = {
  techCode: string;
  techName: string;
  postName?: string;
  items: CurrentTechItem[];
};

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function trimTrailingZero(value: string): string {
  return value.replace(/\.0+$/u, "").replace(/(\.\d*[1-9])0+$/u, "$1");
}

function formatAmount(value: number): string {
  return Number.isInteger(value)
    ? String(Math.trunc(value))
    : trimTrailingZero(value.toFixed(2));
}

function formatChineseBizDate(bizDate: string): string {
  const [year = "", month = "", day = ""] = bizDate.split("-");
  return `${year}年${Number(month)}月${Number(day)}日`;
}

function normalizeText(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function safeJsonParse(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function parseCurrentTechProfile(row: TechCurrentRecord): CurrentTechProfile {
  const raw = safeJsonParse(row.rawJson);
  const itemList = Array.isArray(raw.ItemList) ? raw.ItemList : [];
  return {
    techCode: row.techCode,
    techName: row.techName,
    postName: typeof raw.PostName === "string" ? raw.PostName : undefined,
    items: itemList
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
      .map((entry) => ({
        itemName: typeof entry.ItemName === "string" ? entry.ItemName : undefined,
        itemTypeName: typeof entry.ItemTypeName === "string" ? entry.ItemTypeName : undefined,
        itemCategory:
          entry.ItemCategory === null || entry.ItemCategory === undefined
            ? undefined
            : Number(entry.ItemCategory),
      })),
  };
}

function getItemMetaForRow(
  row: TechUpClockRecord,
  techProfile: CurrentTechProfile | undefined,
): CurrentTechItem | undefined {
  const normalizedItemName = normalizeText(row.itemName);
  if (!normalizedItemName || !techProfile) {
    return undefined;
  }
  return techProfile.items.find((item) => normalizeText(item.itemName) === normalizedItemName);
}

function isEarLike(params: { itemName?: string; itemTypeName?: string; itemCategory?: number }): boolean {
  const itemName = normalizeText(params.itemName);
  const itemTypeName = normalizeText(params.itemTypeName);
  if (/(采耳|耳部|耳脑|眼脑|洗耳|耳烛)/u.test(itemName)) {
    return true;
  }
  return params.itemCategory === 2 && itemTypeName.includes("附项") && /耳/u.test(itemName);
}

function isSmallLike(params: { itemName?: string; itemTypeName?: string; itemCategory?: number }): boolean {
  const itemName = normalizeText(params.itemName);
  const itemTypeName = normalizeText(params.itemTypeName);
  if (/(小项|修脚|刮痧|拔罐)/u.test(itemName)) {
    return true;
  }
  return itemTypeName.includes("小项");
}

function isSpaLike(params: { itemName?: string; itemTypeName?: string }): boolean {
  const itemName = normalizeText(params.itemName);
  const itemTypeName = normalizeText(params.itemTypeName);
  return itemTypeName.includes("按摩") || /(spa|泰式)/u.test(itemName);
}

function resolveServiceBucket(params: {
  itemName?: string;
  itemTypeName?: string;
  itemCategory?: number;
}): ServiceBucket {
  if (isEarLike(params)) {
    return "ear";
  }
  if (isSmallLike(params)) {
    return "small";
  }
  if (isSpaLike(params)) {
    return "spa";
  }
  return "main";
}

function resolvePerformerBucket(profile: CurrentTechProfile | undefined): PerformerBucket {
  const postName = normalizeText(profile?.postName);
  return postName.includes("明星") ? "star" : "strength";
}

function isDedicatedSpecialist(
  profile: CurrentTechProfile,
  target: Exclude<ServiceBucket, "main">,
): boolean {
  const categories = profile.items
    .map((item) =>
      resolveServiceBucket({
        itemName: item.itemName,
        itemTypeName: item.itemTypeName,
        itemCategory: item.itemCategory,
      }),
    )
    .filter((value, index, list) => list.indexOf(value) === index);

  if (target === "ear") {
    return categories.length > 0 && categories.every((value) => value === "ear");
  }
  if (target === "spa") {
    return categories.length > 0 && categories.every((value) => value === "spa");
  }
  if (target === "small") {
    const normalizedNames = profile.items.map((item) => normalizeText(item.itemName));
    return (
      categories.length > 0 &&
      categories.every((value) => value === "small") &&
      normalizedNames.some((name) => name.includes("小项"))
    );
  }
  return false;
}

function resolveAttendanceBucket(profile: CurrentTechProfile | undefined): AttendanceBucket {
  if (!profile) {
    return "strength";
  }
  const postName = normalizeText(profile.postName);
  if (postName.includes("明星")) {
    return "star";
  }
  if (isDedicatedSpecialist(profile, "spa")) {
    return "spa";
  }
  if (isDedicatedSpecialist(profile, "ear")) {
    return "ear";
  }
  if (isDedicatedSpecialist(profile, "small")) {
    return "small";
  }
  return "strength";
}

function createClockBreakdown(): ClockBreakdown {
  return {
    queue: 0,
    selected: 0,
    point: 0,
    add: 0,
    subtotal: 0,
  };
}

function incrementClockBreakdown(
  breakdown: ClockBreakdown,
  bucket: ClockBucket,
  count: number,
): void {
  breakdown[bucket] += count;
  breakdown.subtotal += count;
}

function resolveClockBucket(row: TechUpClockRecord): ClockBucket {
  const raw = safeJsonParse(row.rawJson);
  const addClockType = String(raw.AddClockType ?? "")
    .trim()
    .toLowerCase();
  if (addClockType.length > 0 && addClockType !== "0" && addClockType !== "false" && addClockType !== "null") {
    return "add";
  }
  const clockType = normalizeText(
    typeof raw.ClockType === "string" || typeof raw.ClockType === "number"
      ? String(raw.ClockType)
      : row.clockType,
  );
  if (clockType === "2" || clockType === "point" || clockType === "点钟" || clockType === "pointclock") {
    return "point";
  }
  if (clockType === "3" || clockType === "select" || clockType === "选钟" || clockType === "choose") {
    return "selected";
  }
  return "queue";
}

function buildAttendanceSummary(
  currentTech: TechCurrentRecord[],
  profilesByCode: Map<string, CurrentTechProfile>,
): AttendanceSummary {
  const attendance: AttendanceSummary = {
    strength: 0,
    star: 0,
    spa: 0,
    ear: 0,
    small: 0,
    total: 0,
  };

  for (const tech of currentTech) {
    if (!tech.isJob || !tech.isWork) {
      continue;
    }
    const bucket = resolveAttendanceBucket(profilesByCode.get(tech.techCode));
    attendance[bucket] += 1;
    attendance.total += 1;
  }

  return attendance;
}

function buildAttendanceSummaryFromActiveTech(
  techClockRows: TechUpClockRecord[],
  profilesByCode: Map<string, CurrentTechProfile>,
  fallbackTechRows: TechCurrentRecord[],
): AttendanceSummary {
  const activeTechCodes = Array.from(
    new Set(techClockRows.map((row) => row.personCode).filter((value) => value.length > 0)),
  );
  if (activeTechCodes.length === 0) {
    return buildAttendanceSummary(fallbackTechRows, profilesByCode);
  }

  const attendance: AttendanceSummary = {
    strength: 0,
    star: 0,
    spa: 0,
    ear: 0,
    small: 0,
    total: 0,
  };
  for (const techCode of activeTechCodes) {
    const bucket = resolveAttendanceBucket(profilesByCode.get(techCode));
    attendance[bucket] += 1;
    attendance.total += 1;
  }
  return attendance;
}

function mergeTechProfileRows(
  preferredRows: TechCurrentRecord[],
  fallbackRows: TechCurrentRecord[],
): TechCurrentRecord[] {
  const rowsByCode = new Map<string, TechCurrentRecord>();
  for (const row of fallbackRows) {
    rowsByCode.set(row.techCode, row);
  }
  for (const row of preferredRows) {
    rowsByCode.set(row.techCode, row);
  }
  return Array.from(rowsByCode.values());
}

function formatClockBreakdown(label: string, breakdown: ClockBreakdown): string {
  return `${label}：排${formatAmount(breakdown.queue)} / 选${formatAmount(
    breakdown.selected,
  )} / 点${formatAmount(breakdown.point)} / 加${formatAmount(
    breakdown.add,
  )} / 小计${formatAmount(breakdown.subtotal)}`;
}

function renderOnlineChannels(groupbuyPlatformBreakdown: DailyGroupbuyPlatformMetric[]): string {
  const platformAmountMap = new Map(
    groupbuyPlatformBreakdown.map((entry) => [entry.platform, round(entry.amount)]),
  );
  const parts = [
    `美团${formatAmount(platformAmountMap.get("美团") ?? 0)}元`,
    `抖音${formatAmount(platformAmountMap.get("抖音") ?? 0)}元`,
  ];
  const knownTotal = (platformAmountMap.get("美团") ?? 0) + (platformAmountMap.get("抖音") ?? 0);
  const otherTotal = round(
    groupbuyPlatformBreakdown.reduce((sum, entry) => {
      if (entry.platform === "美团" || entry.platform === "抖音") {
        return sum;
      }
      return sum + entry.amount;
    }, 0),
  );
  if (otherTotal > 0) {
    parts.push(`其他${formatAmount(otherTotal)}元`);
  }
  return parts.join(" + ");
}

function renderOnlineSubtotal(groupbuyPlatformBreakdown: DailyGroupbuyPlatformMetric[]): string {
  return formatAmount(
    round(groupbuyPlatformBreakdown.reduce((sum, entry) => sum + entry.amount, 0)),
  );
}

function renderOfflineChannels(metrics: DailyStoreMetrics): string {
  return `现金${formatAmount(metrics.cashPaymentAmount)}元 + 微信${formatAmount(
    metrics.wechatPaymentAmount,
  )}元 + 支付宝${formatAmount(metrics.alipayPaymentAmount)}元`;
}

function renderOfflineSubtotal(metrics: DailyStoreMetrics): string {
  return formatAmount(
    round(metrics.cashPaymentAmount + metrics.wechatPaymentAmount + metrics.alipayPaymentAmount),
  );
}

function stripStorePrefix(storeName: string): string {
  return storeName.replace(/^荷塘悦色/u, "");
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "N/A";
  }
  return `${formatAmount(round(value * 100, 1))}%`;
}

function formatRateWithCounts(params: {
  rate: number | null | undefined;
  numerator: number;
  denominator: number;
}): string {
  if (params.rate === null || params.rate === undefined || params.denominator <= 0) {
    return "N/A";
  }
  return `${formatPercent(params.rate)} (${formatAmount(params.numerator)}/${formatAmount(params.denominator)})`;
}

function formatOptionalRateWithCounts(params: {
  rate: number | null | undefined;
  numerator: number;
  denominator: number;
}): string | null {
  if (params.rate === null || params.rate === undefined || params.denominator <= 0) {
    return null;
  }
  return formatRateWithCounts(params);
}

function normalizeRate(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0 || value > 1) {
    return null;
  }
  return value;
}

function renderGroupbuyMetricPlatformBreakdown(
  groupbuyPlatformBreakdown: DailyGroupbuyPlatformMetric[],
): string {
  if (groupbuyPlatformBreakdown.length === 0) {
    return "无";
  }
  return groupbuyPlatformBreakdown
    .map((entry) => `${entry.platform} ${formatAmount(entry.orderCount)} 单 / ${entry.amount.toFixed(2)} 元`)
    .join("；");
}

function buildMemberRepurchaseInsight(metrics: DailyStoreMetrics): string {
  const base = metrics.memberRepurchaseBaseCustomerCount7d ?? 0;
  const rate = metrics.memberRepurchaseRate7d;
  if (base <= 0 || rate === null || rate === undefined) {
    return "会员复购样本暂不足，先把首充后的首次耗卡和最近7天回访名单补齐。";
  }
  if (rate < 0.35) {
    return "老会员回流偏弱，储值盘活还没有形成稳定节奏。";
  }
  if (rate < 0.5) {
    return "老会员回流一般，还没有形成稳定复购。";
  }
  return "老会员回流在线，可以继续放大耗卡和续充承接。";
}

function buildGroupbuyConversionInsight(metrics: DailyStoreMetrics): string {
  const cohort = metrics.groupbuyCohortCustomerCount;
  const revisitRate = metrics.groupbuy7dRevisitRate;
  const storedRate = metrics.groupbuy7dStoredValueConversionRate;
  const memberPay30dRate = metrics.groupbuy30dMemberPayConversionRate;

  if (cohort <= 0 || revisitRate === null || revisitRate === undefined) {
    return "当前可追踪团购样本不足，先把团购身份和回流链路补齐。";
  }
  if ((revisitRate ?? 1) < 0.35 && (storedRate ?? 1) < 0.2) {
    return "团购首单后的二次到店和转储值都偏弱，新客承接明显没接住。";
  }
  if ((revisitRate ?? 1) < 0.35) {
    return "团购客能进店但回店弱，先别急着继续放大低价引流。";
  }
  if ((storedRate ?? 1) < 0.2) {
    return "团购客有回流，但会员储值沉淀还偏弱。";
  }
  if ((memberPay30dRate ?? 1) < 0.25) {
    return "团购二次承接已有起色，但转会员消费还不够深。";
  }
  return "团购承接基本在线，可以继续放大高潜团购客沉淀。";
}

function buildGrowthConclusion(metrics: DailyStoreMetrics, businessSignal: ReturnType<typeof evaluateStoreBusinessScore>): string {
  const memberRepurchaseRate = metrics.memberRepurchaseRate7d;
  const memberRepurchaseBase = metrics.memberRepurchaseBaseCustomerCount7d ?? 0;
  const revisitRate = metrics.groupbuy7dRevisitRate;
  const storedRate = metrics.groupbuy7dStoredValueConversionRate;
  const pointClockRate = metrics.pointClockRate ?? 1;
  const addClockRate = metrics.addClockRate ?? 1;
  const sleepingRate = metrics.sleepingMemberRate ?? 0;

  if (
    (metrics.groupbuyCohortCustomerCount > 0 && ((revisitRate ?? 1) < 0.4 || (storedRate ?? 1) < 0.2)) ||
    businessSignal.tags.includes("复到店偏弱")
  ) {
    return "今天先抓团购首单二次到店和开卡/储值收口，先做留存，再做拉新。";
  }
  if (
    (memberRepurchaseBase > 0 && (memberRepurchaseRate ?? 1) < 0.45) ||
    sleepingRate >= 0.15 ||
    businessSignal.tags.includes("沉默会员偏高")
  ) {
    return "今天先抓老会员回店和首充首耗，先做盘活，不只盯充值。";
  }
  if (pointClockRate < 0.45 || addClockRate < 0.3) {
    return "今天先抓高峰班点钟和加钟承接，把到店客流真正转成营收和复购。";
  }
  return "复购和现场承接基本在线，今天继续放大高价值会员和高表现技师贡献。";
}

function buildAnalysisLines(params: {
  metrics: DailyStoreMetrics;
}): string[] {
  const businessSignal = evaluateStoreBusinessScore({
    revenueChange: null,
    clockEffectChange: null,
    groupbuy7dRevisitRate: params.metrics.groupbuy7dRevisitRate,
    groupbuy7dStoredValueConversionRate: params.metrics.groupbuy7dStoredValueConversionRate,
    groupbuyFirstOrderHighValueMemberRate: params.metrics.groupbuyFirstOrderHighValueMemberRate,
    sleepingMemberRate: params.metrics.sleepingMemberRate,
    pointClockRate: params.metrics.pointClockRate,
    addClockRate: params.metrics.addClockRate,
  });
  const memberRepurchase = formatOptionalRateWithCounts({
    rate: params.metrics.memberRepurchaseRate7d,
    numerator: params.metrics.memberRepurchaseReturnedCustomerCount7d ?? 0,
    denominator: params.metrics.memberRepurchaseBaseCustomerCount7d ?? 0,
  });
  const groupbuyRevisit = formatOptionalRateWithCounts({
    rate: params.metrics.groupbuy7dRevisitRate,
    numerator: params.metrics.groupbuy7dRevisitCustomerCount,
    denominator: params.metrics.groupbuyCohortCustomerCount,
  });
  const groupbuyStored = formatOptionalRateWithCounts({
    rate: params.metrics.groupbuy7dStoredValueConversionRate,
    numerator: params.metrics.groupbuy7dStoredValueConvertedCustomerCount,
    denominator: params.metrics.groupbuyCohortCustomerCount,
  });
  const groupbuyMemberPay30d = formatOptionalRateWithCounts({
    rate: params.metrics.groupbuy30dMemberPayConversionRate,
    numerator: params.metrics.groupbuy30dMemberPayConvertedCustomerCount,
    denominator: params.metrics.groupbuyCohortCustomerCount,
  });
  const observations: string[] = [];
  if (memberRepurchase) {
    observations.push(`会员复购：7天复购率${memberRepurchase}`);
  }
  if (groupbuyRevisit || groupbuyStored || groupbuyMemberPay30d) {
    observations.push(
      `团购转化：${[
        groupbuyRevisit ? `7天复到店率${groupbuyRevisit}` : "",
        groupbuyStored ? `7天储值转化率${groupbuyStored}` : "",
        groupbuyMemberPay30d ? `30天会员消费转化率${groupbuyMemberPay30d}` : "",
      ]
        .filter((entry) => entry.length > 0)
        .join("；")}`,
    );
  }

  return [
    `经营判断：${businessSignal.levelLabel}`,
    `核心原因：${businessSignal.tags.join("、")}`,
    ...observations,
    `今日重心：${buildGrowthConclusion(params.metrics, businessSignal)}`,
  ];
}

function buildPriorityActions(params: { metrics: DailyStoreMetrics }): ActionCandidate[] {
  const candidates: ActionCandidate[] = [];
  const pointClockRate = normalizeRate(params.metrics.pointClockRate) ?? 0;
  const addClockRate = normalizeRate(params.metrics.addClockRate) ?? 0;
  const sleepingRate = normalizeRate(params.metrics.sleepingMemberRate);
  const memberRepurchaseRate = normalizeRate(params.metrics.memberRepurchaseRate7d);
  const groupbuyRevisitRate = normalizeRate(params.metrics.groupbuy7dRevisitRate);
  const groupbuyStoredRate = normalizeRate(params.metrics.groupbuy7dStoredValueConversionRate);
  const groupbuyMemberPay30dRate = normalizeRate(params.metrics.groupbuy30dMemberPayConversionRate);
  const groupbuyOrderShare = normalizeRate(params.metrics.groupbuyOrderShare) ?? 0;
  const storedConsumeRate = params.metrics.storedConsumeRate ?? 0;
  const activeRatio =
    params.metrics.onDutyTechCount > 0
      ? params.metrics.activeTechCount / params.metrics.onDutyTechCount
      : 1;
  const activeGap = Math.max(params.metrics.onDutyTechCount - params.metrics.activeTechCount, 0);

  if (params.metrics.onDutyTechCount >= 20 && activeGap >= 10 && activeRatio < 0.65) {
    candidates.push({
      category: "staffing",
      score: 880 + activeGap,
      title: "排班校准",
      target: "在岗与活跃技师名单",
      action: `核对在岗${formatAmount(params.metrics.onDutyTechCount)}位/活跃${formatAmount(
        params.metrics.activeTechCount,
      )}位的真实名单，高峰班只保留真正能上钟的人。`,
      standard: "晚高峰前确认真实在岗、请休和分班口径。",
    });
  }

  if (
    sleepingRate !== null &&
    sleepingRate >= 0.15 &&
    params.metrics.currentStoredBalance > 0
  ) {
    candidates.push({
      category: "member",
      score: 820 + sleepingRate * 100 + Math.min(params.metrics.currentStoredBalance / 50000, 40),
      title: "会员回流",
      target: "高余额沉默会员",
      action: `先跟进高余额沉默会员，优先盘活${formatAmount(
        params.metrics.currentStoredBalance,
      )}元储值余额。`,
      standard: "形成高余额名单并锁定回店或回访节奏。",
    });
  } else if (
    (params.metrics.memberRepurchaseBaseCustomerCount7d ?? 0) >= 10 &&
    memberRepurchaseRate !== null &&
    memberRepurchaseRate < 0.35
  ) {
    candidates.push({
      category: "member",
      score: 760 + (0.35 - memberRepurchaseRate) * 100,
      title: "会员回流",
      target: "近7天未再到店会员、首充未耗卡会员",
      action: "先跟进近7天来过未再到店和首充未耗卡会员，今天先锁预约。",
      standard: "完成重点名单触达并锁定回店或首耗时间。",
    });
  } else if (params.metrics.newMembers > 0) {
    candidates.push({
      category: "member",
      score: 520 + params.metrics.newMembers,
      title: "新增首耗",
      target: "昨日新增会员",
      action: `回访昨日新增${formatAmount(params.metrics.newMembers)}位会员，优先推动首次耗卡。`,
      standard: "形成首耗跟进名单并锁定首耗时间。",
    });
  }

  if (
    params.metrics.groupbuyCohortCustomerCount > 0 &&
    groupbuyRevisitRate !== null &&
    groupbuyStoredRate !== null &&
    groupbuyMemberPay30dRate !== null
  ) {
    if (groupbuyRevisitRate < 0.35 && groupbuyStoredRate < 0.2) {
      candidates.push({
        category: "groupbuy",
        score: 840 + groupbuyOrderShare * 100,
        title: "团购回流",
        target: "近7天团购首单客",
        action: "回访近7天团购首单客，先锁二次到店，再补开卡或储值。",
        standard: "确认到店时间或明确未到店原因。",
      });
    } else if (groupbuyRevisitRate < 0.35) {
      candidates.push({
        category: "groupbuy",
        score: 780 + groupbuyOrderShare * 100,
        title: "团购回流",
        target: "近7天团购客",
        action: "先把近7天团购客约回二次到店，不再只追新单量。",
        standard: "形成二次到店预约名单。",
      });
    } else if (groupbuyStoredRate < 0.2 || groupbuyMemberPay30dRate < 0.25) {
      candidates.push({
        category: "groupbuy",
        score: 730 + groupbuyOrderShare * 100,
        title: "团购储值",
        target: "高意向团购客",
        action: "团购客离店前完成开卡或储值收口，别只停在首单。",
        standard: "高意向团购客全部有开卡或储值跟进结果。",
      });
    }
  } else if (
    params.metrics.groupbuyOrderCount > 0 &&
    (groupbuyOrderShare >= 0.2 || params.metrics.groupbuyOrderCount >= 8)
  ) {
    candidates.push({
      category: "groupbuy",
      score: 690 + groupbuyOrderShare * 100,
      title: "团购承接",
      target: "近3天团购客",
      action: `团购占比${formatPercent(params.metrics.groupbuyOrderShare)}，今天先做近3天团购客留资、回访和二次到店。`,
      standard: "近3天团购客名单全部完成跟进标记。",
    });
  }

  if (addClockRate < 0.08) {
    candidates.push({
      category: "onsite",
      score: 790 + (0.08 - addClockRate) * 100,
      title: "加钟收口",
      target: "当班前台与技师",
      action: "统一服务后半程加钟动作、话术和时机。",
      standard: "班后沉淀3条可复用话术，并复盘加钟结果。",
    });
  } else if (pointClockRate < 0.3) {
    candidates.push({
      category: "onsite",
      score: 720 + (0.3 - pointClockRate) * 100,
      title: "点钟承接",
      target: "高意向顾客分单",
      action: "高意向客优先给强点钟技师，前台分单不要平均用力。",
      standard: "班后复盘点钟率不低于昨日。",
    });
  } else if (pointClockRate < 0.45 || addClockRate < 0.15) {
    candidates.push({
      category: "onsite",
      score: 660 + Math.max(0.45 - pointClockRate, 0) * 100 + Math.max(0.15 - addClockRate, 0) * 100,
      title: "高峰分单",
      target: "高峰班前台与技师",
      action: "高意向客优先给强点钟或加钟技师，离店前完成下次到店建议或储值收口。",
      standard: "班后复盘点钟率和加钟率不低于昨日。",
    });
  } else {
    candidates.push({
      category: "onsite",
      score: 420,
      title: "高峰放大",
      target: "高峰班高表现技师",
      action: "把高表现技师放到更核心时段，继续放大点钟、加钟和回店承接。",
      standard: "班后沉淀3条可复制的高峰承接动作。",
    });
  }

  if (params.metrics.rechargeCash > 0 && storedConsumeRate < 0.8) {
    candidates.push({
      category: "finance",
      score: 700 + (0.8 - storedConsumeRate) * 100,
      title: "耗卡盘活",
      target: "高余额会员、首充未耗卡会员",
      action: "高余额会员和首充未耗卡会员优先约回店耗卡，不再只盯充值。",
      standard: "形成耗卡预约名单并跟进到店。",
    });
  }

  const bestByCategory = new Map<ActionCandidateCategory, ActionCandidate>();
  for (const candidate of candidates) {
    const existing = bestByCategory.get(candidate.category);
    if (!existing || candidate.score > existing.score) {
      bestByCategory.set(candidate.category, candidate);
    }
  }

  const ranked = Array.from(bestByCategory.values()).sort((left, right) => right.score - left.score);
  return ranked.slice(0, 3);
}

function buildActionLines(params: {
  metrics: DailyStoreMetrics;
}): string[] {
  const source = buildPriorityActions(params);
  const trimActionSentence = (value: string): string => value.trim().replace(/[。；]+$/u, "");
  return source.flatMap((item, index) => [
    `${index + 1}. ${item.title}`,
    `对象：${trimActionSentence(item.target)}`,
    `动作：${trimActionSentence(item.action)}`,
    `目标：${trimActionSentence(item.standard)}`,
    ...(index < source.length - 1 ? [""] : []),
  ]);
}

function renderMarkdownHardBreaks(lines: string[]): string {
  return lines.map((line) => (line.length > 0 ? `${line}  ` : "")).join("\n");
}

function buildSupplementConversionLines(metrics: DailyStoreMetrics): string[] {
  const lines: string[] = [];
  if (
    metrics.highBalanceSleepingMemberCount !== undefined &&
    metrics.highBalanceSleepingMemberAmount !== undefined
  ) {
    lines.push(
      `高余额沉默会员：${formatAmount(metrics.highBalanceSleepingMemberCount)}人 / ${formatAmount(
        metrics.highBalanceSleepingMemberAmount,
      )}元`,
    );
  }
  if (
    metrics.firstChargeUnconsumedMemberCount !== undefined &&
    metrics.firstChargeUnconsumedMemberAmount !== undefined
  ) {
    lines.push(
      `首充未耗卡：${formatAmount(metrics.firstChargeUnconsumedMemberCount)}人 / ${formatAmount(
        metrics.firstChargeUnconsumedMemberAmount,
      )}元`,
    );
  }
  const memberRepurchase = formatOptionalRateWithCounts({
    rate: metrics.memberRepurchaseRate7d,
    numerator: metrics.memberRepurchaseReturnedCustomerCount7d ?? 0,
    denominator: metrics.memberRepurchaseBaseCustomerCount7d ?? 0,
  });
  if (memberRepurchase) {
    lines.push(`会员7天复购率：${memberRepurchase}`);
  }

  if (metrics.groupbuyCohortCustomerCount > 0) {
    const revisit = formatOptionalRateWithCounts({
      rate: metrics.groupbuy7dRevisitRate,
      numerator: metrics.groupbuy7dRevisitCustomerCount,
      denominator: metrics.groupbuyCohortCustomerCount,
    });
    const cardOpened = formatOptionalRateWithCounts({
      rate: metrics.groupbuy7dCardOpenedRate,
      numerator: metrics.groupbuy7dCardOpenedCustomerCount,
      denominator: metrics.groupbuyCohortCustomerCount,
    });
    const stored = formatOptionalRateWithCounts({
      rate: metrics.groupbuy7dStoredValueConversionRate,
      numerator: metrics.groupbuy7dStoredValueConvertedCustomerCount,
      denominator: metrics.groupbuyCohortCustomerCount,
    });
    const memberPay30d = formatOptionalRateWithCounts({
      rate: metrics.groupbuy30dMemberPayConversionRate,
      numerator: metrics.groupbuy30dMemberPayConvertedCustomerCount,
      denominator: metrics.groupbuyCohortCustomerCount,
    });
    if (revisit) {
      lines.push(`7天复到店率：${revisit}`);
    }
    if (cardOpened) {
      lines.push(`7天开卡率：${cardOpened}`);
    }
    if (stored) {
      lines.push(`7天储值转化率：${stored}`);
    }
    if (memberPay30d) {
      lines.push(`30天会员消费转化率：${memberPay30d}`);
    }
  }

  const firstOrderHighValue = formatOptionalRateWithCounts({
    rate: metrics.groupbuyFirstOrderHighValueMemberRate,
    numerator: metrics.groupbuyFirstOrderHighValueMemberCustomerCount,
    denominator: metrics.groupbuyFirstOrderCustomerCount,
  });
  if (firstOrderHighValue) {
    lines.push(`团购首单客转高价值会员率：${firstOrderHighValue}`);
  }

  return lines;
}

export async function buildStoreManagerDailyDetail(params: {
  store: HetangOpsStore;
  orgId: string;
  bizDate: string;
  metrics: DailyStoreMetrics;
}): Promise<StoreManagerDailyDetail> {
  const [consumeBills, techClockRows, currentTech, techDailySnapshot] = await Promise.all([
    params.store.listConsumeBillsByDate(params.orgId, params.bizDate),
    params.store.listTechUpClockByDate(params.orgId, params.bizDate),
    params.store.listCurrentTech(params.orgId),
    typeof (params.store as { listTechDailySnapshotByDate?: unknown }).listTechDailySnapshotByDate ===
      "function"
      ? (
          params.store as {
            listTechDailySnapshotByDate: (
              orgId: string,
              bizDate: string,
            ) => Promise<TechCurrentRecord[]>;
          }
        ).listTechDailySnapshotByDate(params.orgId, params.bizDate)
      : Promise.resolve([] as TechCurrentRecord[]),
  ]);
  const historicalTechRows = techDailySnapshot.length > 0 ? techDailySnapshot : currentTech;
  const profileRows = mergeTechProfileRows(historicalTechRows, currentTech);
  const profilesByCode = new Map<string, CurrentTechProfile>(
    profileRows.map((tech) => [tech.techCode, parseCurrentTechProfile(tech)]),
  );
  const attendance = buildAttendanceSummaryFromActiveTech(
    techClockRows,
    profilesByCode,
    historicalTechRows,
  );
  const strengthMain = createClockBreakdown();
  const starMain = createClockBreakdown();
  const strengthSpa = createClockBreakdown();
  const starSpa = createClockBreakdown();
  let earClockCount = 0;
  let smallClockCount = 0;

  for (const row of techClockRows) {
    const count = round(row.count);
    const profile = profilesByCode.get(row.personCode);
    const itemMeta = getItemMetaForRow(row, profile);
    const serviceBucket = resolveServiceBucket({
      itemName: row.itemName,
      itemTypeName: itemMeta?.itemTypeName,
      itemCategory: itemMeta?.itemCategory,
    });
    const clockBucket = resolveClockBucket(row);

    if (serviceBucket === "ear") {
      earClockCount += count;
      continue;
    }
    if (serviceBucket === "small") {
      smallClockCount += count;
      continue;
    }

    const performerBucket = resolvePerformerBucket(profile);
    const targetBreakdown =
      serviceBucket === "spa"
        ? performerBucket === "star"
          ? starSpa
          : strengthSpa
        : performerBucket === "star"
          ? starMain
          : strengthMain;
    incrementClockBreakdown(targetBreakdown, clockBucket, count);
  }

  const totalRevenue = round(
    consumeBills
      .filter((row) => !row.antiFlag)
      .reduce((sum, row) => sum + row.consumeAmount, 0),
  );
  const onlineSubtotal = round(
    params.metrics.groupbuyPlatformBreakdown.reduce((sum, entry) => sum + entry.amount, 0),
  );
  const offlineSubtotal = round(
    params.metrics.cashPaymentAmount + params.metrics.wechatPaymentAmount + params.metrics.alipayPaymentAmount,
  );
  const cashPerformance = round(params.metrics.rechargeCash + onlineSubtotal + offlineSubtotal);

  return {
    attendance,
    strengthMain,
    starMain,
    strengthSpa,
    starSpa,
    earClockCount: round(earClockCount),
    smallClockCount: round(smallClockCount),
    mainClockCount: round(strengthMain.subtotal + starMain.subtotal),
    totalRevenue: totalRevenue > 0 ? totalRevenue : round(params.metrics.serviceRevenue),
    actualRevenue: round(params.metrics.serviceRevenue),
    cashPerformance,
  };
}

export function renderStoreManagerDailyReport(params: {
  storeName: string;
  bizDate: string;
  metrics: DailyStoreMetrics;
  detail: StoreManagerDailyDetail;
  alerts: DailyStoreAlert[];
  suggestions: string[];
}): string {
  const title = `${formatChineseBizDate(params.bizDate)} ${stripStorePrefix(params.storeName)}经营数据报告`;
  const analysisLines = buildAnalysisLines({
    metrics: params.metrics,
  });
  const actionLines = buildActionLines({
    metrics: params.metrics,
  });
  const supplementLines = buildSupplementConversionLines(params.metrics);

  return renderMarkdownHardBreaks([
    title,
    "营业日口径：次日03:00截止",
    "",
    "【技师出勤】",
    `实力${formatAmount(params.detail.attendance.strength)}位 / 明星${formatAmount(
      params.detail.attendance.star,
    )}位 / SPA${formatAmount(params.detail.attendance.spa)}位`,
    `采耳${formatAmount(params.detail.attendance.ear)}位 / 小项${formatAmount(
      params.detail.attendance.small,
    )}位 / 共计${formatAmount(params.detail.attendance.total)}位`,
    "",
    "【钟数结构】",
    formatClockBreakdown("实力", params.detail.strengthMain),
    formatClockBreakdown("明星", params.detail.starMain),
    formatClockBreakdown("实力SPA", params.detail.strengthSpa),
    formatClockBreakdown("明星SPA", params.detail.starSpa),
    "",
    "【核心经营】",
    `主项总钟数：${formatAmount(params.detail.mainClockCount)}个`,
    `采耳钟数：${formatAmount(params.detail.earClockCount)}个`,
    `小项钟数：${formatAmount(params.detail.smallClockCount)}个`,
    `点钟率：${formatPercent(params.metrics.pointClockRate)}`,
    `加钟率：${formatPercent(params.metrics.addClockRate)}`,
    "",
    `会员卡：实充${formatAmount(params.metrics.rechargeCash)}元 / 实耗${formatAmount(
      params.metrics.storedConsumeAmount,
    )}元`,
    `线上：${renderOnlineChannels(params.metrics.groupbuyPlatformBreakdown)}`,
    `线上小计：${renderOnlineSubtotal(params.metrics.groupbuyPlatformBreakdown)}元`,
    `线下：${renderOfflineChannels(params.metrics)}`,
    `线下小计：${renderOfflineSubtotal(params.metrics)}元`,
    `营收：总${formatAmount(params.detail.totalRevenue)}元 / 实收${formatAmount(
      params.detail.actualRevenue,
    )}元`,
    `现金业绩：${formatAmount(params.detail.cashPerformance)}元`,
    "",
    "【经营分析】",
    ...analysisLines,
    "",
    "【今日动作】",
    ...actionLines,
    "",
    "【补充指标】",
    `团购订单：${formatAmount(params.metrics.groupbuyOrderCount)}单`,
    `团购占比：${formatPercent(params.metrics.groupbuyOrderShare)}`,
    `团购金额：${formatAmount(params.metrics.groupbuyAmount)}元`,
    `团购平台：${renderGroupbuyMetricPlatformBreakdown(params.metrics.groupbuyPlatformBreakdown)}`,
    `沉默会员占比：${formatPercent(params.metrics.sleepingMemberRate)}`,
    ...supplementLines,
  ]);
}
