import {
  evaluateCustomerBusinessScore,
  type CustomerBusinessSignal,
} from "./business-score.js";
import type { HetangQueryIntent, HetangQueryTimeFrame } from "./query-intent.js";
import type {
  ConsumeBillRecord,
  CustomerProfile90dRow,
  CustomerSegmentRecord,
  CustomerTechLinkRecord,
  HetangOpsConfig,
  MemberCardCurrentRecord,
  MemberCurrentRecord,
  TechMarketRecord,
  TechUpClockRecord,
} from "./types.js";

type CustomerProfileRuntime = {
  findCurrentMembersByPhoneSuffix?: (params: {
    orgId: string;
    phoneSuffix: string;
  }) => Promise<MemberCurrentRecord[]>;
  listCurrentMembers?: (params: { orgId: string }) => Promise<MemberCurrentRecord[]>;
  listCurrentMemberCards?: (params: { orgId: string }) => Promise<MemberCardCurrentRecord[]>;
  listConsumeBillsByDateRange?: (params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) => Promise<ConsumeBillRecord[]>;
  listCustomerTechLinks?: (params: {
    orgId: string;
    bizDate: string;
  }) => Promise<CustomerTechLinkRecord[]>;
  listCustomerTechLinksByDateRange?: (params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) => Promise<CustomerTechLinkRecord[]>;
  listTechUpClockByDateRange?: (params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) => Promise<TechUpClockRecord[]>;
  listTechMarketByDateRange?: (params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) => Promise<TechMarketRecord[]>;
  listCustomerSegments?: (params: {
    orgId: string;
    bizDate: string;
  }) => Promise<CustomerSegmentRecord[]>;
  listCustomerProfile90dByDateRange?: (params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) => Promise<CustomerProfile90dRow[]>;
};

type CustomerNarrativeSnapshot = {
  primarySegment?: CustomerSegmentRecord["primarySegment"];
  recencySegment?: CustomerSegmentRecord["recencySegment"];
  paymentSegment?: CustomerSegmentRecord["paymentSegment"];
  techLoyaltySegment?: CustomerSegmentRecord["techLoyaltySegment"];
  payAmount30d?: number;
  payAmount90d?: number;
  visitCount30d?: number;
  visitCount90d?: number;
  topTechName?: string;
  currentStoredAmount?: number;
  currentSilentDays?: number;
  currentLastConsumeTime?: string;
  firstGroupbuyBizDate?: string;
  revisitWithin7d?: boolean;
  revisitWithin30d?: boolean;
  cardOpenedWithin7d?: boolean;
  storedValueConvertedWithin7d?: boolean;
  memberPayConvertedWithin30d?: boolean;
  highValueMemberWithin30d?: boolean;
};

type ParsedPayment = {
  name: string;
  amount: number;
};

type ProfileFocus = "summary" | "tech" | "project" | "tea" | "meal" | "addon" | "waterbar";

type RankedPreference = {
  name: string;
  count: number;
  amount: number;
};

type WaterbarSignal = {
  billCount: number;
  payAmount: number;
  latestBizDate?: string;
  roomMap: Map<string, { count: number; amount: number }>;
  paymentMap: Map<string, { count: number; amount: number }>;
};

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function formatCurrency(value: number): string {
  return `${round(value, 2).toFixed(2)} 元`;
}

function normalizeText(value: string | undefined): string {
  return value?.replace(/\s+/gu, "").trim().toLowerCase() ?? "";
}

function getStoreName(config: HetangOpsConfig, orgId: string): string {
  return config.stores.find((entry) => entry.orgId === orgId)?.storeName ?? orgId;
}

function maskName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return "未实名客户";
  }
  if (trimmed.length === 1) {
    return "*";
  }
  return `${trimmed.slice(0, 1)}${"*".repeat(Math.min(trimmed.length - 1, 2))}`;
}

function parsePayments(rawJson: string): ParsedPayment[] {
  try {
    const parsed = JSON.parse(rawJson) as { Payments?: Array<Record<string, unknown>> };
    if (!Array.isArray(parsed.Payments)) {
      return [];
    }
    return parsed.Payments.reduce<ParsedPayment[]>((list, payment) => {
      if (!payment || typeof payment !== "object" || Array.isArray(payment)) {
        return list;
      }
      const name = String(payment.Name ?? "").trim();
      const amount = Number(payment.Amount ?? 0);
      if (!name || !Number.isFinite(amount) || amount <= 0) {
        return list;
      }
      list.push({ name, amount });
      return list;
    }, []);
  } catch {
    return [];
  }
}

function extractInfoRefs(rawJson: string): Array<{ displayName?: string; referenceCode?: string }> {
  try {
    const parsed = JSON.parse(rawJson) as { Infos?: unknown[] };
    if (!Array.isArray(parsed.Infos)) {
      return [];
    }
    return parsed.Infos.reduce<Array<{ displayName?: string; referenceCode?: string }>>(
      (list, entry) => {
        const infoText = String(entry ?? "").trim();
        if (!infoText) {
          return list;
        }
        const lead = infoText.split(",")[0]?.trim() ?? infoText;
        const referenceCode = lead.match(/\[([^\]]+)\]/u)?.[1]?.trim();
        const displayName = lead
          .replace(/\([^)]*\)/gu, "")
          .replace(/\[[^\]]*\]/gu, "")
          .trim();
        list.push({
          displayName: displayName || undefined,
          referenceCode: referenceCode || undefined,
        });
        return list;
      },
      [],
    );
  } catch {
    return [];
  }
}

function parseConsumeBillMetadata(rawJson: string): {
  roomCode?: string;
  customerName?: string;
  operatorName?: string;
} {
  try {
    const parsed = JSON.parse(rawJson) as Record<string, unknown>;
    const roomCode = String(parsed.RoomCode ?? parsed.RoomCodes ?? "").trim();
    const customerName = String(parsed.CName ?? "").trim();
    const operatorName = String(parsed.OptName ?? "").trim();
    return {
      roomCode: roomCode || undefined,
      customerName: customerName || undefined,
      operatorName: operatorName || undefined,
    };
  } catch {
    return {};
  }
}

function buildCardIndex(cards: MemberCardCurrentRecord[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const card of cards) {
    const cardNo = normalizeText(card.cardNo);
    if (cardNo) {
      index.set(cardNo, card.memberId);
    }
  }
  return index;
}

type BillMatchReason = "phone" | "card" | "display-name";

function createBizDateList(frame: HetangQueryTimeFrame): string[] {
  if (frame.kind === "single") {
    return [frame.bizDate];
  }
  const bizDates: string[] = [];
  for (let cursor = frame.startBizDate; cursor <= frame.endBizDate; ) {
    bizDates.push(cursor);
    const next = new Date(`${cursor}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    cursor = next.toISOString().slice(0, 10);
  }
  return bizDates;
}

function shiftBizDate(bizDate: string, delta: number): string {
  const next = new Date(`${bizDate}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + delta);
  return next.toISOString().slice(0, 10);
}

function buildBackwardBizDateWindow(
  endBizDate: string,
  maxDays: number,
  floorBizDate?: string,
): string[] {
  const values: string[] = [];
  for (let offset = 0; offset < maxDays; offset += 1) {
    const bizDate = shiftBizDate(endBizDate, -offset);
    if (floorBizDate && bizDate < floorBizDate) {
      break;
    }
    values.push(bizDate);
  }
  return values;
}

function diffBizDays(laterBizDate: string, earlierBizDate: string): number {
  const later = new Date(`${laterBizDate}T00:00:00Z`);
  const earlier = new Date(`${earlierBizDate}T00:00:00Z`);
  return Math.round((later.getTime() - earlier.getTime()) / 86_400_000);
}

function buildCustomerNarrativeSnapshot(params: {
  segment?: CustomerSegmentRecord;
  profileRow?: CustomerProfile90dRow;
}): CustomerNarrativeSnapshot | undefined {
  const { segment, profileRow } = params;
  if (!segment && !profileRow) {
    return undefined;
  }
  return {
    primarySegment: profileRow?.primarySegment ?? segment?.primarySegment,
    recencySegment: profileRow?.recencySegment ?? segment?.recencySegment,
    paymentSegment: profileRow?.paymentSegment ?? segment?.paymentSegment,
    techLoyaltySegment: profileRow?.techLoyaltySegment ?? segment?.techLoyaltySegment,
    payAmount30d: profileRow?.payAmount30d ?? segment?.payAmount30d,
    payAmount90d: profileRow?.payAmount90d ?? segment?.payAmount90d,
    visitCount30d: profileRow?.visitCount30d ?? segment?.visitCount30d,
    visitCount90d: profileRow?.visitCount90d ?? segment?.visitCount90d,
    topTechName: profileRow?.topTechName ?? segment?.topTechName,
    currentStoredAmount: profileRow?.currentStoredAmount,
    currentSilentDays: profileRow?.currentSilentDays,
    currentLastConsumeTime: profileRow?.currentLastConsumeTime,
    firstGroupbuyBizDate: profileRow?.firstGroupbuyBizDate,
    revisitWithin7d: profileRow?.revisitWithin7d,
    revisitWithin30d: profileRow?.revisitWithin30d,
    cardOpenedWithin7d: profileRow?.cardOpenedWithin7d,
    storedValueConvertedWithin7d: profileRow?.storedValueConvertedWithin7d,
    memberPayConvertedWithin30d: profileRow?.memberPayConvertedWithin30d,
    highValueMemberWithin30d: profileRow?.highValueMemberWithin30d,
  };
}

function selectNearestProfileSnapshot(params: {
  rows: CustomerProfile90dRow[];
  memberId: string;
  snapshotBizDate: string;
}): CustomerProfile90dRow | undefined {
  const rows = params.rows.filter((row) => row.memberId === params.memberId);
  if (rows.length === 0) {
    return undefined;
  }

  const sameOrEarlier = rows
    .filter((row) => row.windowEndBizDate <= params.snapshotBizDate)
    .sort((left, right) => right.windowEndBizDate.localeCompare(left.windowEndBizDate));
  if (sameOrEarlier.length > 0) {
    return sameOrEarlier[0];
  }

  return rows.sort((left, right) => {
    const leftDistance = Math.abs(diffBizDays(left.windowEndBizDate, params.snapshotBizDate));
    const rightDistance = Math.abs(diffBizDays(right.windowEndBizDate, params.snapshotBizDate));
    if (leftDistance !== rightDistance) {
      return leftDistance - rightDistance;
    }
    return left.windowEndBizDate.localeCompare(right.windowEndBizDate);
  })[0];
}

function resolveBillMatchReason(params: {
  consumeBill: ConsumeBillRecord;
  member: MemberCurrentRecord;
  memberCardIndex: Map<string, string>;
  allowDisplayNameFallback: boolean;
}): BillMatchReason | null {
  const refs = extractInfoRefs(params.consumeBill.rawJson);
  if (refs.length === 0) {
    return null;
  }
  const normalizedPhone = normalizeText(params.member.phone);
  const normalizedName = normalizeText(params.member.name);
  for (const ref of refs) {
    const code = normalizeText(ref.referenceCode);
    if (!code) {
      const displayName = normalizeText(ref.displayName);
      if (
        params.allowDisplayNameFallback &&
        normalizedName &&
        displayName &&
        displayName === normalizedName
      ) {
        return "display-name";
      }
      continue;
    }
    if (normalizedPhone && code === normalizedPhone) {
      return "phone";
    }
    if (params.memberCardIndex.get(code) === params.member.memberId) {
      return "card";
    }
    const displayName = normalizeText(ref.displayName);
    if (
      params.allowDisplayNameFallback &&
      normalizedName &&
      displayName &&
      displayName === normalizedName
    ) {
      return "display-name";
    }
  }
  return null;
}

function hasAmbiguousSameNameHistory(params: {
  consumeBills: ConsumeBillRecord[];
  member: MemberCurrentRecord;
  memberCardIndex: Map<string, string>;
}): boolean {
  const normalizedPhone = normalizeText(params.member.phone);
  const normalizedName = normalizeText(params.member.name);
  if (!normalizedName) {
    return false;
  }

  for (const bill of params.consumeBills) {
    if (bill.antiFlag) {
      continue;
    }
    for (const ref of extractInfoRefs(bill.rawJson)) {
      const displayName = normalizeText(ref.displayName);
      if (!displayName || displayName !== normalizedName) {
        continue;
      }
      const code = normalizeText(ref.referenceCode);
      if (!code) {
        return true;
      }
      if (normalizedPhone && code === normalizedPhone) {
        continue;
      }
      if (params.memberCardIndex.get(code) === params.member.memberId) {
        continue;
      }
      return true;
    }
  }

  return false;
}

function buildIdentityAmbiguityMessage(params: {
  storeName: string;
  suffix: string;
  memberName: string;
}): string {
  return [
    `${params.storeName} 尾号${params.suffix} ${maskName(params.memberName)} 当前无法安全归并画像。`,
    "- 系统发现门店内存在同名会员，且历史消费未命中当前会员的手机号或会员卡号。",
    "- 为避免把同名不同人的消费错误并到一起，请补充完整手机号、会员卡号，或直接指定顾客本人再查询。",
  ].join("\n");
}

function resolveProfileFocus(text: string): ProfileFocus {
  if (/(水吧|茶水)/u.test(text)) {
    return "waterbar";
  }
  if (/(茶|茶饮|饮品|喝什么)/u.test(text)) {
    return "tea";
  }
  if (/(餐|饭|面|粥|小吃|吃什么)/u.test(text)) {
    return "meal";
  }
  if (/(副项|加购|附加|商品|额外购买)/u.test(text)) {
    return "addon";
  }
  if (/(技师|老师|点钟)/u.test(text)) {
    return "tech";
  }
  if (/(项目|常做|常点|做什么)/u.test(text)) {
    return "project";
  }
  return "summary";
}

function resolveSegmentLabel(key: string | undefined): string | undefined {
  switch (key) {
    case "important-value-member":
      return "重要价值会员";
    case "important-reactivation-member":
      return "重要唤回会员";
    case "potential-growth-customer":
      return "潜力发展客户";
    case "groupbuy-retain-candidate":
      return "团购留存候选";
    case "active-member":
      return "活跃会员";
    case "sleeping-customer":
      return "沉睡会员";
    case "standard-customer":
      return "标准客户";
    default:
      return undefined;
  }
}

function classifyVisitBucket(optTime: string): string {
  const hour = Number(optTime.slice(11, 13));
  if (!Number.isFinite(hour)) {
    return "未知时段";
  }
  if (hour >= 23 || hour < 5) {
    return "夜场";
  }
  if (hour >= 17) {
    return "晚场";
  }
  return "午场";
}

function classifyDayBucket(bizDate: string): string {
  const weekday = new Date(`${bizDate}T00:00:00Z`).getUTCDay();
  return weekday === 0 || weekday === 6 ? "周末" : "工作日";
}

function topLines(
  title: string,
  source: Map<string, { count: number; amount: number }>,
  limit = 3,
  emptyText = "暂无稳定记录",
): string[] {
  const rows = rankPreferences(source).slice(0, limit);
  if (rows.length === 0) {
    return [`- ${title}: ${emptyText}`];
  }
  return rows.map((row, index) => {
    const prefix = index === 0 ? `- ${title}: ` : "  ";
    return `${prefix}${row.name} ${row.count} 次 ${formatCurrency(row.amount)}`;
  });
}

function rankPreferences(
  source: Map<string, { count: number; amount: number }>,
): RankedPreference[] {
  return Array.from(source.entries())
    .map(([name, value]) => ({
      name,
      count: value.count,
      amount: value.amount,
    }))
    .sort(
      (left, right) =>
        right.count - left.count ||
        right.amount - left.amount ||
        left.name.localeCompare(right.name),
    );
}

function topPreferenceName(
  source: Map<string, { count: number; amount: number }>,
): string | undefined {
  return rankPreferences(source)[0]?.name;
}

function sumPreferenceAmount(source: Map<string, { count: number; amount: number }>): number {
  return round(
    Array.from(source.values()).reduce((sum, row) => sum + row.amount, 0),
    2,
  );
}

function resolveLocalDateParts(now: Date, timeZone: string): { bizDate: string; hour: number } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return {
    bizDate: `${values.get("year")}-${values.get("month")}-${values.get("day")}`,
    hour: Number(values.get("hour") ?? "0"),
  };
}

function classifyVisitBucketByHour(hour: number): string {
  if (!Number.isFinite(hour)) {
    return "未知时段";
  }
  if (hour >= 23 || hour < 5) {
    return "夜场";
  }
  if (hour >= 17) {
    return "晚场";
  }
  return "午场";
}

function resolveSilentRisk(params: {
  member: MemberCurrentRecord;
  snapshot?: CustomerNarrativeSnapshot;
}): { label: "低" | "中" | "高"; reason: string } {
  const silentDays = params.snapshot?.currentSilentDays ?? params.member.silentDays;
  if (
    params.snapshot?.primarySegment === "important-reactivation-member" ||
    params.snapshot?.primarySegment === "sleeping-customer" ||
    silentDays >= 90
  ) {
    return {
      label: "高",
      reason: `当前沉默 ${silentDays} 天，已进入重点唤回窗口。`,
    };
  }
  if (silentDays >= 30) {
    return {
      label: "中",
      reason: `当前沉默 ${silentDays} 天，已明显偏离正常复购节奏。`,
    };
  }
  return silentDays >= 7
    ? {
        label: "低",
        reason: `当前沉默 ${silentDays} 天，可提前做轻回访防止转冷。`,
      }
    : {
        label: "低",
        reason: `当前沉默 ${silentDays} 天，仍在相对活跃窗口。`,
      };
}

function resolveCustomerGrade(params: {
  member: MemberCurrentRecord;
  snapshot?: CustomerNarrativeSnapshot;
  matchedBillCount: number;
  matchedPayAmount: number;
}): { label: string; reason: string } {
  const payAmount90d = params.snapshot?.payAmount90d ?? params.matchedPayAmount;
  const visitCount90d = params.snapshot?.visitCount90d ?? params.matchedBillCount;

  if (params.snapshot?.primarySegment === "important-reactivation-member") {
    return {
      label: "A级待唤回",
      reason: "历史消费价值高，但近期活跃度明显下滑，需要重点人工拉回。",
    };
  }

  if (
    params.snapshot?.primarySegment === "important-value-member" ||
    payAmount90d >= 1200 ||
    visitCount90d >= 5
  ) {
    return {
      label: "A级高价值",
      reason: "近90天消费金额和到店频次都处在高位，值得持续重点维护。",
    };
  }

  if (
    params.snapshot?.primarySegment === "potential-growth-customer" ||
    payAmount90d >= 600 ||
    visitCount90d >= 3
  ) {
    return {
      label: "B级成长型",
      reason: "已有稳定消费基础，再做定向运营有机会继续往上走。",
    };
  }

  if (payAmount90d > 0 || visitCount90d > 0 || params.member.consumeAmount > 0) {
    return {
      label: "C级基础维护",
      reason: "已有到店和消费记录，但价值贡献还在培养阶段。",
    };
  }

  return {
    label: "D级待激活",
    reason: "消费记录偏少，先验证真实需求，再决定是否深度运营。",
  };
}

function resolveLifecycleStage(params: {
  member: MemberCurrentRecord;
  snapshot?: CustomerNarrativeSnapshot;
}): { label: string; reason: string } {
  const silentDays = params.snapshot?.currentSilentDays ?? params.member.silentDays;
  switch (params.snapshot?.recencySegment) {
    case "active-7d":
      return {
        label: "活跃复购期",
        reason: "最近7天内有到店，仍处于高响应窗口。",
      };
    case "active-30d":
      return {
        label: "活跃维护期",
        reason: "最近30天内仍有消费，适合做轻提醒和定向复购。",
      };
    case "silent-31-90d":
      return {
        label: "沉默预警期",
        reason: `已沉默 ${silentDays} 天，需要尽快做针对性回访。`,
      };
    case "sleeping-91-180d":
      return {
        label: "深度沉睡期",
        reason: `已沉默 ${silentDays} 天，单靠群发触达通常不够。`,
      };
    case "lost-180d-plus":
      return {
        label: "高流失风险期",
        reason: `已沉默 ${silentDays} 天，需要按挽回客户来处理。`,
      };
    default:
      return silentDays <= 7
        ? {
            label: "活跃复购期",
            reason: "近期刚到店，适合以服务体验为主做轻回访。",
          }
        : silentDays <= 30
          ? {
              label: "活跃维护期",
              reason: `已沉默 ${silentDays} 天，仍在可维护窗口内。`,
            }
          : {
              label: "沉默预警期",
              reason: `已沉默 ${silentDays} 天，建议尽早人工跟进。`,
            };
  }
}

function resolvePaymentPattern(snapshot?: CustomerNarrativeSnapshot): string {
  switch (snapshot?.paymentSegment) {
    case "member-only":
      return "会员/储值支付占主导";
    case "groupbuy-only":
      return "团购引流特征明显";
    case "mixed-member-nonmember":
      return "会员与现付混合消费";
    case "groupbuy-plus-direct":
      return "团购转现付仍有提升空间";
    case "direct-only":
      return "现付消费为主，储值转化空间较大";
    default:
      return "支付结构暂未形成特别稳定的单一路径";
  }
}

function buildCustomerValueAnalysis(params: {
  member: MemberCurrentRecord;
  snapshot?: CustomerNarrativeSnapshot;
  matchedBillCount: number;
  matchedPayAmount: number;
}): string {
  const payAmount90d = params.snapshot?.payAmount90d ?? params.matchedPayAmount;
  const visitCount90d = params.snapshot?.visitCount90d ?? params.matchedBillCount;
  const techPreference =
    params.snapshot?.techLoyaltySegment === "single-tech-loyal"
      ? "技师偏好稳定"
      : params.snapshot?.techLoyaltySegment === "multi-tech"
        ? "会在多个技师之间切换"
        : "技师偏好仍在形成";
  const valueTone =
    params.snapshot?.primarySegment === "important-reactivation-member"
      ? "属于历史高价值、当前待唤回客户"
      : params.snapshot?.primarySegment === "important-value-member" ||
          payAmount90d >= 1200 ||
          visitCount90d >= 5
        ? "属于门店应重点维护的高价值复购客户"
        : payAmount90d >= 600 || visitCount90d >= 3
          ? "属于有明显成长空间的稳定消费客户"
          : "当前更适合做基础维护和消费习惯培养";

  return `近90天到店 ${visitCount90d} 次、消费 ${formatCurrency(payAmount90d)}，${resolvePaymentPattern(
    params.snapshot,
  )}，${techPreference}，${valueTone}。`;
}

function summarizeCadence(params: {
  snapshot?: CustomerNarrativeSnapshot;
  matchedBills: ConsumeBillRecord[];
  snapshotBizDate: string;
}): string {
  const countBillsWithin = (days: number) => {
    const startBizDate = shiftBizDate(params.snapshotBizDate, -(days - 1));
    const bills = params.matchedBills.filter(
      (bill) => bill.bizDate >= startBizDate && bill.bizDate <= params.snapshotBizDate,
    );
    return {
      visitCount: bills.length,
      payAmount: round(
        bills.reduce((sum, bill) => sum + bill.payAmount, 0),
        2,
      ),
    };
  };

  const recent30d = countBillsWithin(30);
  const recent90d = countBillsWithin(90);
  const visitCount30d = params.snapshot?.visitCount30d ?? recent30d.visitCount;
  const payAmount30d = params.snapshot?.payAmount30d ?? recent30d.payAmount;
  const visitCount90d = params.snapshot?.visitCount90d ?? recent90d.visitCount;
  const payAmount90d = params.snapshot?.payAmount90d ?? recent90d.payAmount;

  return `近30天 ${visitCount30d} 次 / ${formatCurrency(payAmount30d)}；近90天 ${visitCount90d} 次 / ${formatCurrency(payAmount90d)}。`;
}

function buildPaymentStructureDiagnosis(params: {
  paymentMap: Map<string, { count: number; amount: number }>;
  snapshot?: CustomerNarrativeSnapshot;
}): string {
  const rankedPayments = rankPreferences(params.paymentMap);
  if (rankedPayments.length === 0) {
    return "暂无可识别支付明细，先补齐会员、现付、团购的拆分数据。";
  }

  const totalAmount = rankedPayments.reduce((sum, row) => sum + row.amount, 0);
  const primary = rankedPayments[0];
  const secondary = rankedPayments[1];
  const primaryShare = totalAmount > 0 ? primary.amount / totalAmount : 0;
  const primaryName = normalizeText(primary.name);
  const secondaryHint = secondary ? `，偶尔用${secondary.name}补差` : "";

  if (
    params.snapshot?.paymentSegment === "member-only" ||
    (primaryName.includes("会员") && primaryShare >= 0.6)
  ) {
    return `以会员/储值支付为主${secondaryHint}，说明客户对门店会员体系接受度较高，优先做约到店而不是先发通用券。`;
  }
  if (
    params.snapshot?.paymentSegment === "groupbuy-only" ||
    params.snapshot?.paymentSegment === "groupbuy-plus-direct" ||
    primaryName.includes("团购")
  ) {
    return "团购支付特征仍较明显，重点不是继续降价，而是把首单后的复到店、开卡和储值承接做好。";
  }
  if (
    params.snapshot?.paymentSegment === "direct-only" ||
    primaryName.includes("微信") ||
    primaryName.includes("支付宝") ||
    primaryName.includes("现金")
  ) {
    return `当前以现付为主${secondaryHint}，说明消费意愿在，但会员开卡和储值转化还有空间。`;
  }
  return `支付方式较混合，当前主路径是${primary.name}${secondary ? `，其次是${secondary.name}` : ""}，适合按到店项目和技师偏好做更精准的承接。`;
}

function buildConsumptionStructure(params: {
  matchedPayAmount: number;
  teaMap: Map<string, { count: number; amount: number }>;
  mealMap: Map<string, { count: number; amount: number }>;
  addonMap: Map<string, { count: number; amount: number }>;
}): string {
  const teaAmount = sumPreferenceAmount(params.teaMap);
  const mealAmount = sumPreferenceAmount(params.mealMap);
  const addonAmount = sumPreferenceAmount(params.addonMap);
  const sideRevenue = round(teaAmount + mealAmount + addonAmount, 2);
  const serviceRevenue = round(Math.max(params.matchedPayAmount - sideRevenue, 0), 2);

  if (sideRevenue <= 0) {
    return `服务消费约 ${formatCurrency(params.matchedPayAmount)}，当前账单里还没有识别到茶饮、餐食或其他副项明细。`;
  }

  return `服务消费约 ${formatCurrency(serviceRevenue)}，附加消费 ${formatCurrency(sideRevenue)}；其中茶饮 ${formatCurrency(teaAmount)}、餐食 ${formatCurrency(mealAmount)}、其他副项 ${formatCurrency(addonAmount)}。`;
}

function buildFollowupScript(params: {
  silentRisk: { label: "低" | "中" | "高"; reason: string };
  topTech?: string;
  topProject?: string;
}): string {
  if (params.silentRisk.label === "高") {
    if (params.topTech && params.topProject) {
      return `先做关怀唤回，再以${params.topTech}和${params.topProject}重新建联。`;
    }
    if (params.topTech) {
      return `先做关怀唤回，再以${params.topTech}的服务记忆重新建联。`;
    }
    if (params.topProject) {
      return `先做关怀唤回，再围绕${params.topProject}重启复购邀约。`;
    }
    return "先做关怀唤回，确认客户最近流失原因后再给项目方案。";
  }
  if (params.topTech && params.topProject) {
    return `以${params.topTech}近期服务体验切入，主推${params.topProject}复购邀约。`;
  }
  if (params.topProject) {
    return `围绕${params.topProject}体验做轻回访，顺带确认本周复购意向。`;
  }
  if (params.topTech) {
    return `从${params.topTech}近期服务反馈切入，先约下一次到店时间。`;
  }
  return "先做轻关怀回访，再根据最近一次消费内容补项目建议。";
}

function buildTouchChannel(params: {
  member: MemberCurrentRecord;
  silentRisk: { label: "低" | "中" | "高"; reason: string };
  preferredVisitBucket?: string;
}): string {
  const preferredVisitBucket = params.preferredVisitBucket ?? "晚场";
  if (params.silentRisk.label === "高") {
    return "电话优先，其次企微1对1补触达，避免只发群消息。";
  }
  if (params.member.silentDays <= 7) {
    return `企微1对1消息优先，临近${preferredVisitBucket}再补一轮轻提醒。`;
  }
  if (params.member.silentDays <= 30) {
    return `企微1对1先触达，未回复再电话跟进，优先卡在${preferredVisitBucket}前。`;
  }
  return "电话和企微1对1结合触达，避免只靠单次文本消息。";
}

function estimateRepurchaseProbability(params: {
  member: MemberCurrentRecord;
  snapshot?: CustomerNarrativeSnapshot;
  silentRisk: { label: "低" | "中" | "高"; reason: string };
  topTech?: string;
  topProject?: string;
  matchedBillCount: number;
}): { label: "高" | "中" | "低"; reason: string } {
  if (params.silentRisk.label === "高") {
    return {
      label: "低",
      reason: "已进入重点唤回窗口，需靠人工回访拉回",
    };
  }

  const visitCount30d = params.snapshot?.visitCount30d ?? Math.min(params.matchedBillCount, 1);
  const stablePreference = Boolean(params.topTech && params.topProject);
  if (
    params.member.silentDays <= 7 &&
    (stablePreference ||
      params.snapshot?.primarySegment === "important-value-member" ||
      visitCount30d >= 2)
  ) {
    return {
      label: "高",
      reason: "近30天有到店、项目与技师偏好稳定",
    };
  }

  if (params.member.silentDays <= 30 || stablePreference || visitCount30d >= 1) {
    return {
      label: "中",
      reason: "仍有消费记忆，但需要合适窗口和针对性回访",
    };
  }

  return {
    label: "低",
    reason: "近期开口成本偏高，复购需要更多人工干预",
  };
}

function buildCouponAdvice(params: {
  member: MemberCurrentRecord;
  silentRisk: { label: "低" | "中" | "高"; reason: string };
  topTech?: string;
  topProject?: string;
}): string {
  if (params.silentRisk.label === "高") {
    if (params.topProject) {
      return `建议发券，优先发${params.topProject}项目券，不建议只发通用代金券。`;
    }
    return "建议发券，优先发项目券或限时回访券，不建议只发通用代金券。";
  }

  if (params.member.silentDays <= 7) {
    if (params.topProject) {
      return `暂不建议先发通用券，优先直接约${params.topTech ?? "熟悉技师"}或定向${params.topProject}项目券。`;
    }
    return "暂不建议先发通用券，先做轻回访确认客户近期时间。";
  }

  if (params.member.silentDays <= 30) {
    if (params.topProject) {
      return `可视情况发小额${params.topProject}项目券，重点是把人先拉回到店。`;
    }
    return "可发小额项目券，但要配合人工回访，不建议只群发通用券。";
  }

  return "建议先电话判断意向，再决定是否补发项目券。";
}

type ManagerActionPlan = {
  topTech?: string;
  topProject?: string;
  silentRisk: { label: "低" | "中" | "高"; reason: string };
  touchAdvice: string;
  followupScript: string;
  touchChannel: string;
  repurchaseProbability: { label: "高" | "中" | "低"; reason: string };
  couponAdvice: string;
  opportunity: string;
  actions: string[];
};

function buildManagerOpportunity(params: {
  businessSignal: CustomerBusinessSignal;
  silentRisk: { label: "低" | "中" | "高"; reason: string };
  topTech?: string;
  topProject?: string;
}): string {
  if (params.silentRisk.label === "高") {
    if (params.topTech && params.topProject) {
      return `技师偏好还在，说明关系没完全断，适合用${params.topTech}和${params.topProject}重新建联。`;
    }
    if (params.topTech) {
      return `技师偏好还在，说明关系没完全断，适合先从${params.topTech}的服务记忆切回。`;
    }
    if (params.topProject) {
      return `项目偏好还在，说明服务记忆没完全消失，适合先从${params.topProject}重启联系。`;
    }
    return "虽然客户已转冷，但历史消费还在，先用1对1关怀把联系重新拉起来。";
  }
  if (params.topTech && params.topProject) {
    return "技师偏好和项目偏好都清晰，最适合做1对1复购邀约。";
  }
  if (params.topTech) {
    return `技师偏好已形成，适合直接由${params.topTech}发起下一次到店邀约。`;
  }
  if (params.topProject) {
    return `项目偏好已形成，适合围绕${params.topProject}做精准回访。`;
  }
  if (params.businessSignal.tierLabel === "团购留存") {
    return "还在团购承接窗口里，关键是把二次到店和开卡动作接住。";
  }
  return "当前消费记忆还在，先约下一次到店，再决定要不要上券或储值动作。";
}

function buildManagerSummaryLine(params: {
  businessSignal: CustomerBusinessSignal;
  topTech?: string;
  topProject?: string;
}): string {
  switch (params.businessSignal.tierLabel) {
    case "高价值待唤回":
      if (params.topTech && params.topProject) {
        return `高价值待唤回会员，老客已明显转冷，先人工唤回，优先从${params.topTech}和${params.topProject}重新建联。`;
      }
      return "高价值待唤回会员，老客已明显转冷，先人工唤回，再把熟客关系重新接上。";
    case "高价值稳态":
      if (params.topTech) {
        return `高价值稳态会员，复购基础不错，适合直接约${params.topTech}做下一次到店，不建议先靠发券刺激。`;
      }
      return "高价值稳态会员，复购基础不错，优先直接约下一次到店，不建议先靠发券刺激。";
    case "潜力成长":
      return "潜力成长会员，消费基础已形成，当前重点是把复购推进到会员留存或储值。";
    case "团购留存":
      return "团购留存客户，当前重点不是继续降价，而是把二次到店和开卡承接接住。";
    default:
      return "基础维护客户，先确认最近体验和可约时间，再决定是否加大触达。";
  }
}

function buildManagerActionPlan(params: {
  member: MemberCurrentRecord;
  snapshot?: CustomerNarrativeSnapshot;
  techMap: Map<string, { count: number; amount: number }>;
  projectMap: Map<string, { count: number; amount: number }>;
  visitBucketMap: Map<string, { count: number; amount: number }>;
  dayBucketMap: Map<string, { count: number; amount: number }>;
  businessSignal: CustomerBusinessSignal;
  matchedBillCount: number;
  timeZone: string;
  now: Date;
}): ManagerActionPlan {
  const topTech = topPreferenceName(params.techMap) ?? params.snapshot?.topTechName;
  const topProject = topPreferenceName(params.projectMap);
  const silentRisk = resolveSilentRisk({
    member: params.member,
    snapshot: params.snapshot,
  });
  const localNow = resolveLocalDateParts(params.now, params.timeZone);
  const currentDayBucket = classifyDayBucket(localNow.bizDate);
  const currentVisitBucket = classifyVisitBucketByHour(localNow.hour);
  const preferredDayBucket = topPreferenceName(params.dayBucketMap);
  const preferredVisitBucket = topPreferenceName(params.visitBucketMap);
  const dayMatch = !preferredDayBucket || preferredDayBucket === currentDayBucket;
  const visitMatch = !preferredVisitBucket || preferredVisitBucket === currentVisitBucket;
  const followupScript = buildFollowupScript({
    silentRisk,
    topTech,
    topProject,
  });
  const touchChannel = buildTouchChannel({
    member: params.member,
    silentRisk,
    preferredVisitBucket,
  });
  const repurchaseProbability = estimateRepurchaseProbability({
    member: params.member,
    snapshot: params.snapshot,
    silentRisk,
    topTech,
    topProject,
    matchedBillCount: params.matchedBillCount,
  });
  const couponAdvice = buildCouponAdvice({
    member: params.member,
    silentRisk,
    topTech,
    topProject,
  });

  let touchAdvice: string;
  if (params.member.silentDays <= 3) {
    touchAdvice = "否，最近刚到店，今天以轻关怀为主，不建议强促销触达。";
  } else if (dayMatch && visitMatch) {
    touchAdvice = `是，今天处在其偏好${currentDayBucket}${currentVisitBucket}窗口，适合现在触达。`;
  } else if (dayMatch && preferredVisitBucket) {
    touchAdvice = `部分适合，今天日期匹配，建议等到${preferredVisitBucket}前 1 小时触达。`;
  } else if (silentRisk.label === "高") {
    touchAdvice = `是，但今天并非最佳偏好窗口，建议先做关怀回访，优先放在${preferredVisitBucket ?? currentVisitBucket}触达。`;
  } else {
    touchAdvice = `否，今天不是其高匹配触达窗口，建议优先等${preferredDayBucket ?? currentDayBucket}${preferredVisitBucket ?? currentVisitBucket}再触达。`;
  }

  const actions: string[] = [];
  if (silentRisk.label === "高") {
    actions.push(`先电话关怀，再由${topTech ?? "前台"}或前台补 1 对 1 唤回`);
  } else if (topTech) {
    actions.push(`先让${topTech}或前台做 1 对 1 邀约`);
  } else {
    actions.push("先由前台做 1 对 1 轻回访，先把下一次到店约上");
  }

  if (topProject) {
    actions.push(`${silentRisk.label === "高" ? "回访主推" : "主推"}${topProject}`);
  } else {
    actions.push("围绕最近一次消费项目做复购回访，不先推杂项");
  }

  if (silentRisk.label === "高") {
    actions.push("这类客户可以补项目券，但不要只发通用代金券");
  } else if (params.member.silentDays <= 7) {
    actions.push("暂不建议先发通用券");
  } else if (params.member.silentDays <= 30) {
    actions.push("可配合小额项目券，但必须和人工回访一起做");
  } else {
    actions.push("先确认意向，再决定是否补券");
  }

  return {
    topTech,
    topProject,
    silentRisk,
    touchAdvice,
    followupScript,
    touchChannel,
    repurchaseProbability,
    couponAdvice,
    opportunity: buildManagerOpportunity({
      businessSignal: params.businessSignal,
      silentRisk,
      topTech,
      topProject,
    }),
    actions,
  };
}

function buildGroupbuyConversionLine(snapshot?: CustomerNarrativeSnapshot): string | null {
  if (!snapshot?.firstGroupbuyBizDate) {
    return null;
  }
  const parts = [
    `首次团购 ${snapshot.firstGroupbuyBizDate}`,
    snapshot.revisitWithin7d ? "7天复到店已接住" : "7天复到店仍未接住",
    snapshot.cardOpenedWithin7d ? "7天开卡已接住" : "7天开卡未接住",
    snapshot.storedValueConvertedWithin7d ? "7天储值已转化" : "7天储值未转化",
    snapshot.memberPayConvertedWithin30d ? "30天会员消费已转化" : "30天会员消费未转化",
    snapshot.highValueMemberWithin30d ? "30天高价值会员已形成" : "30天高价值会员仍未形成",
  ];
  return `- 团购承接快照: ${parts.join("，")}。`;
}

function buildGroupbuyConversionSummary(snapshot?: CustomerNarrativeSnapshot): string | undefined {
  if (!snapshot?.firstGroupbuyBizDate) {
    return undefined;
  }
  const parts = [
    `首次团购 ${snapshot.firstGroupbuyBizDate}`,
    snapshot.revisitWithin7d ? "7天复到店已接住" : "7天复到店未接住",
    snapshot.cardOpenedWithin7d ? "7天开卡已接住" : "7天开卡未接住",
    snapshot.storedValueConvertedWithin7d ? "7天储值已转化" : "7天储值未转化",
    snapshot.memberPayConvertedWithin30d ? "30天会员消费已转化" : "30天会员消费未转化",
    snapshot.highValueMemberWithin30d ? "30天高价值会员已形成" : "30天高价值会员未形成",
  ];
  return parts.join("，");
}

function appendSection(
  lines: string[],
  title: string,
  items: string[],
  options?: { numbered?: boolean },
): void {
  if (items.length === 0) {
    return;
  }
  if (lines.length > 0) {
    lines.push("");
  }
  lines.push(title);
  if (options?.numbered) {
    items.forEach((item, index) => {
      lines.push(`${index + 1}. ${item}`);
    });
    return;
  }
  items.forEach((item) => {
    lines.push(`- ${item}`);
  });
}

function classifyAddonCategory(row: TechMarketRecord): "tea" | "meal" | "oil" | "addon" | "service" {
  const itemName = row.itemName ?? "";
  const itemTypeName = row.itemTypeName ?? "";
  if (/(茶|饮|奶|咖啡|可乐|雪碧|椰汁|红牛|果汁|苏打)/u.test(itemName) || /饮/u.test(itemTypeName)) {
    return "tea";
  }
  if (
    /(饭|面|粉|粥|饺|馄饨|小吃|炒饭|米线|套餐|夜宵)/u.test(itemName) ||
    /(餐|食品|小吃)/u.test(itemTypeName)
  ) {
    return "meal";
  }
  if (/精油|油/u.test(itemName)) {
    return "oil";
  }
  if (
    row.itemCategory === 1 ||
    row.itemCategory === 2 ||
    /(足浴类|按摩类|理疗类|明星类|实力类|线上)/u.test(itemTypeName) ||
    /(足道|足疗|spa|加钟|按摩|护理|洗面)/iu.test(itemName)
  ) {
    return "service";
  }
  return "addon";
}

function buildSpecialtyPreferenceEmptyMessage(params: {
  focus: "tea" | "meal" | "addon";
  matchedTechMarketRows: TechMarketRecord[];
  recognizedSideRows: TechMarketRecord[];
}): string {
  if (params.matchedTechMarketRows.length === 0) {
    switch (params.focus) {
      case "tea":
        return "当前查询窗口没有可用于判断茶饮偏好的副项明细。";
      case "meal":
        return "当前查询窗口没有可用于判断餐食偏好的副项明细。";
      case "addon":
        return "当前查询窗口没有可用于判断副项偏好的明细。";
    }
  }

  if (params.recognizedSideRows.length === 0) {
    switch (params.focus) {
      case "tea":
        return "当前已同步的1.7明细主要是服务项目或加钟记录，没有独立茶饮消费字段。";
      case "meal":
        return "当前已同步的1.7明细主要是服务项目或加钟记录，没有独立餐食消费字段。";
      case "addon":
        return "当前已同步的1.7明细主要是服务项目或加钟记录，没有独立副项消费字段。";
    }
  }

  switch (params.focus) {
    case "tea":
      return "当前客户暂无独立茶饮消费记录。";
    case "meal":
      return "当前客户暂无独立餐食消费记录。";
    case "addon":
      return "当前客户暂无独立副项消费记录。";
  }
}

function isWaterbarConsumeBill(bill: ConsumeBillRecord): boolean {
  const metadata = parseConsumeBillMetadata(bill.rawJson);
  return /(水吧|水吧台|水吧服务员)/u.test(
    [metadata.customerName, metadata.operatorName, bill.rawJson].filter(Boolean).join(" "),
  );
}

function buildWaterbarSignal(bills: ConsumeBillRecord[]): WaterbarSignal {
  const roomMap = new Map<string, { count: number; amount: number }>();
  const paymentMap = new Map<string, { count: number; amount: number }>();
  const waterbarBills = bills.filter((bill) => isWaterbarConsumeBill(bill));
  let latestBizDate: string | undefined;
  let payAmount = 0;

  const bump = (
    source: Map<string, { count: number; amount: number }>,
    key: string,
    amount: number,
  ) => {
    const current = source.get(key) ?? { count: 0, amount: 0 };
    current.count += 1;
    current.amount = round(current.amount + amount, 2);
    source.set(key, current);
  };

  for (const bill of waterbarBills) {
    payAmount = round(payAmount + bill.payAmount, 2);
    if (!latestBizDate || bill.bizDate > latestBizDate) {
      latestBizDate = bill.bizDate;
    }
    const metadata = parseConsumeBillMetadata(bill.rawJson);
    if (metadata.roomCode) {
      bump(roomMap, metadata.roomCode, bill.payAmount);
    }
    for (const payment of parsePayments(bill.rawJson)) {
      bump(paymentMap, payment.name, payment.amount);
    }
  }

  return {
    billCount: waterbarBills.length,
    payAmount,
    latestBizDate,
    roomMap,
    paymentMap,
  };
}

function buildWaterbarSummaryLine(params: {
  signal: WaterbarSignal;
  timeFrameLabel: string;
}): string | undefined {
  if (params.signal.billCount <= 0) {
    return undefined;
  }
  return `水吧相关消费：${params.timeFrameLabel}识别到 ${params.signal.billCount} 次 / ${formatCurrency(
    params.signal.payAmount,
  )}（按水吧相关结算单代理）`;
}

function renderWaterbarDetail(params: {
  storeName: string;
  suffix: string;
  maskedName: string;
  signal: WaterbarSignal;
  timeFrameLabel: string;
}): string {
  const lines = [`${params.storeName} 尾号${params.suffix} ${params.maskedName} 水吧相关消费`];
  if (params.signal.billCount <= 0) {
    lines.push(`- ${params.timeFrameLabel}未识别到水吧相关结算单。`);
    lines.push("- 当前接口只返回水吧相关结算单，不返回具体茶饮或餐食商品名。");
    return lines.join("\n");
  }

  lines.push(
    `- ${params.timeFrameLabel}识别到水吧相关结算 ${params.signal.billCount} 次 / ${formatCurrency(
      params.signal.payAmount,
    )}`,
  );
  if (params.signal.latestBizDate) {
    lines.push(`- 最近一次 ${params.signal.latestBizDate}`);
  }
  const topRooms = rankPreferences(params.signal.roomMap).slice(0, 3);
  if (topRooms.length > 0) {
    lines.push(
      `- 常见房间：${topRooms
        .map((row) => `${row.name} ${row.count} 次`)
        .join("，")}`,
    );
  }
  const topPayments = rankPreferences(params.signal.paymentMap).slice(0, 2);
  if (topPayments.length > 0) {
    lines.push(
      `- 结算方式：${topPayments
        .map((row) => `${row.name} ${row.count} 次 ${formatCurrency(row.amount)}`)
        .join("，")}`,
    );
  }
  lines.push("- 当前接口只返回水吧相关结算单，不返回具体茶饮或餐食商品名。");
  return lines.join("\n");
}

function buildCandidateList(params: {
  storeName: string;
  members: MemberCurrentRecord[];
  segmentMap: Map<string, CustomerSegmentRecord>;
}): string {
  const lines = [
    `${params.storeName} 尾号匹配到 ${params.members.length} 位会员，请补充姓名或门店进一步确认`,
  ];
  params.members.slice(0, 5).forEach((member, index) => {
    const segment = params.segmentMap.get(member.memberId);
    lines.push(
      `${index + 1}. ${maskName(member.name)} | 最近到店 ${member.lastConsumeTime ?? "N/A"} | 储值 ${formatCurrency(member.storedAmount)}${segment ? ` | ${resolveSegmentLabel(segment.primarySegment) ?? segment.primarySegment}` : ""}`,
    );
  });
  return lines.join("\n");
}

export async function executePhoneSuffixCustomerProfileQuery(params: {
  runtime: CustomerProfileRuntime;
  config: HetangOpsConfig;
  intent: HetangQueryIntent;
  effectiveOrgIds: string[];
  now?: Date;
}): Promise<string> {
  const suffix = params.intent.phoneSuffix?.replace(/\D/gu, "");
  if (!suffix || suffix.length !== 4) {
    return "请提供手机号后四位，例如：义乌店尾号7500客户画像。";
  }
  if (params.effectiveOrgIds.length !== 1) {
    return "尾号画像查询当前先按单店执行，请在问题里带上门店名。";
  }
  if (
    !params.runtime.findCurrentMembersByPhoneSuffix ||
    !params.runtime.listCurrentMemberCards ||
    !params.runtime.listConsumeBillsByDateRange ||
    !params.runtime.listTechMarketByDateRange ||
    !params.runtime.listCustomerSegments
  ) {
    return "当前环境还未接通尾号客户画像查询能力。";
  }

  const [orgId] = params.effectiveOrgIds;
  const storeName = getStoreName(params.config, orgId);
  const members = await params.runtime.findCurrentMembersByPhoneSuffix({
    orgId,
    phoneSuffix: suffix,
  });
  if (members.length === 0) {
    return `${storeName} 未找到尾号 ${suffix} 的会员记录。`;
  }

  const snapshotBizDate =
    params.intent.timeFrame.kind === "single"
      ? params.intent.timeFrame.bizDate
      : params.intent.timeFrame.endBizDate;
  const snapshotProbeStartBizDate =
    params.intent.timeFrame.kind === "single"
      ? params.intent.timeFrame.bizDate
      : params.intent.timeFrame.startBizDate;
  const snapshotProbeDates = buildBackwardBizDateWindow(snapshotBizDate, 7, snapshotProbeStartBizDate);
  const segmentSnapshots = await Promise.all(
    snapshotProbeDates.map((bizDate) =>
      params.runtime.listCustomerSegments!({
        orgId,
        bizDate,
      }),
    ),
  );
  const datedSegmentSnapshots = snapshotProbeDates.map((bizDate, index) => ({
    bizDate,
    rows: segmentSnapshots[index],
  }));
  const resolvedSnapshotBizDate =
    datedSegmentSnapshots.find((entry) => entry.rows.length > 0)?.bizDate ?? snapshotBizDate;
  const segmentMapByMemberId = new Map<string, CustomerSegmentRecord>();
  for (const entry of datedSegmentSnapshots) {
    for (const row of entry.rows) {
      if (!row.memberId || !row.identityStable || segmentMapByMemberId.has(row.memberId)) {
        continue;
      }
      segmentMapByMemberId.set(row.memberId, row);
    }
  }

  if (members.length > 1) {
    return buildCandidateList({
      storeName,
      members,
      segmentMap: segmentMapByMemberId,
    });
  }

  const member = members[0];
  const startBizDate =
    params.intent.timeFrame.kind === "single"
      ? params.intent.timeFrame.bizDate
      : params.intent.timeFrame.startBizDate;
  const endBizDate =
    params.intent.timeFrame.kind === "single"
      ? params.intent.timeFrame.bizDate
      : params.intent.timeFrame.endBizDate;
  const profileRows = params.runtime.listCustomerProfile90dByDateRange
    ? await params.runtime.listCustomerProfile90dByDateRange({
        orgId,
        startBizDate: shiftBizDate(resolvedSnapshotBizDate, -1),
        endBizDate: shiftBizDate(resolvedSnapshotBizDate, 1),
      })
    : [];
  const [currentMembers, cards, consumeBills, techLinksByDay, techRows, techMarketRows] =
    await Promise.all([
      params.runtime.listCurrentMembers
        ? params.runtime.listCurrentMembers({ orgId })
        : Promise.resolve([member]),
    params.runtime.listCurrentMemberCards({ orgId }),
    params.runtime.listConsumeBillsByDateRange({
      orgId,
      startBizDate,
      endBizDate,
    }),
    params.runtime.listCustomerTechLinksByDateRange
      ? params.runtime.listCustomerTechLinksByDateRange({
          orgId,
          startBizDate,
          endBizDate,
        })
      : params.runtime.listCustomerTechLinks
        ? Promise.all(
            createBizDateList(params.intent.timeFrame).map((bizDate) =>
              params.runtime.listCustomerTechLinks!({ orgId, bizDate }),
            ),
          ).then((rows) => rows.flat())
        : Promise.resolve([]),
    params.runtime.listTechUpClockByDateRange
      ? params.runtime.listTechUpClockByDateRange({
          orgId,
          startBizDate,
          endBizDate,
        })
      : Promise.resolve([]),
    params.runtime.listTechMarketByDateRange({
      orgId,
      startBizDate,
      endBizDate,
    }),
    ]);
  const rawProfileSnapshot = selectNearestProfileSnapshot({
    rows: profileRows.filter((row) => row.identityStable),
    memberId: member.memberId,
    snapshotBizDate: resolvedSnapshotBizDate,
  });

  const memberCardIndex = buildCardIndex(cards);
  const sameNameCurrentMembers = currentMembers.filter(
    (currentMember) => normalizeText(currentMember.name) === normalizeText(member.name),
  );
  const allowDisplayNameFallback = sameNameCurrentMembers.length <= 1;
  const matchedBillEntries = consumeBills
    .filter((row) => !row.antiFlag)
    .map((row) => ({
      row,
      matchReason: resolveBillMatchReason({
        consumeBill: row,
        member,
        memberCardIndex,
        allowDisplayNameFallback,
      }),
    }))
    .filter(
      (entry): entry is { row: ConsumeBillRecord; matchReason: BillMatchReason } =>
        entry.matchReason !== null,
    );
  const matchedBills = matchedBillEntries.map((entry) => entry.row);
  const hasAmbiguousSameName =
    !allowDisplayNameFallback &&
    hasAmbiguousSameNameHistory({
      consumeBills,
      member,
      memberCardIndex,
    });
  const profileSnapshot = rawProfileSnapshot;
  const narrativeSnapshot = buildCustomerNarrativeSnapshot({
    segment: segmentMapByMemberId.get(member.memberId),
    profileRow: profileSnapshot,
  });
  if (hasAmbiguousSameName && matchedBills.length === 0 && !profileSnapshot) {
    return buildIdentityAmbiguityMessage({
      storeName,
      suffix,
      memberName: member.name,
    });
  }
  const matchedSettleNos = new Set(
    matchedBills.map((row) => normalizeText(row.settleNo)).filter(Boolean),
  );
  const matchedTechLinks = Array.from(
    techLinksByDay
      .filter((row) => {
        if (!row.identityStable) {
          return false;
        }
        if (matchedSettleNos.has(normalizeText(row.settleNo))) {
          return true;
        }
        if (row.memberId && row.memberId === member.memberId) {
          return true;
        }
        const normalizedReference = normalizeText(row.referenceCode);
        return (
          normalizedReference.length > 0 &&
          (normalizedReference === normalizeText(member.phone) ||
            memberCardIndex.get(normalizedReference) === member.memberId)
        );
      })
      .reduce((index, row) => {
        const dedupeKey = [
          normalizeText(row.settleId),
          normalizeText(row.techCode),
          normalizeText(row.customerIdentityKey),
        ].join("|");
        if (!index.has(dedupeKey)) {
          index.set(dedupeKey, row);
        }
        return index;
      }, new Map<string, CustomerTechLinkRecord>())
      .values(),
  );
  const matchedTechRows = techRows.filter((row) =>
    matchedSettleNos.has(normalizeText(row.settleNo)),
  );
  const matchedTechMarketRows = techMarketRows.filter((row) =>
    matchedSettleNos.has(normalizeText(row.settleNo)),
  );

  const paymentMap = new Map<string, { count: number; amount: number }>();
  const visitBucketMap = new Map<string, { count: number; amount: number }>();
  const dayBucketMap = new Map<string, { count: number; amount: number }>();
  const techMap = new Map<string, { count: number; amount: number }>();
  const projectMap = new Map<string, { count: number; amount: number }>();
  const teaMap = new Map<string, { count: number; amount: number }>();
  const mealMap = new Map<string, { count: number; amount: number }>();
  const addonMap = new Map<string, { count: number; amount: number }>();

  const bump = (
    source: Map<string, { count: number; amount: number }>,
    key: string,
    count: number,
    amount: number,
  ) => {
    if (!key) {
      return;
    }
    const current = source.get(key) ?? { count: 0, amount: 0 };
    current.count += count;
    current.amount = round(current.amount + amount, 2);
    source.set(key, current);
  };

  for (const bill of matchedBills) {
    for (const payment of parsePayments(bill.rawJson)) {
      bump(paymentMap, payment.name, 1, payment.amount);
    }
    bump(visitBucketMap, classifyVisitBucket(bill.optTime), 1, bill.payAmount);
    bump(dayBucketMap, classifyDayBucket(bill.bizDate), 1, bill.payAmount);
  }

  if (matchedTechLinks.length > 0) {
    for (const row of matchedTechLinks) {
      bump(techMap, row.techName, 1, row.techTurnover);
      for (const itemName of row.itemNames) {
        bump(projectMap, itemName || "未识别项目", 1, row.techTurnover);
      }
    }
  } else {
    for (const row of matchedTechRows) {
      bump(techMap, row.personName, 1, row.turnover);
      bump(projectMap, row.itemName ?? "未识别项目", 1, row.turnover);
    }
  }

  for (const row of matchedTechMarketRows) {
    const category = classifyAddonCategory(row);
    if (category === "service") {
      continue;
    }
    const amount = row.afterDisc;
    if (category === "tea") {
      bump(teaMap, row.itemName ?? "未识别茶饮", row.count, amount);
    } else if (category === "meal") {
      bump(mealMap, row.itemName ?? "未识别餐食", row.count, amount);
    } else {
      bump(addonMap, row.itemName ?? "未识别副项", row.count, amount);
    }
  }

  const focus = resolveProfileFocus(params.intent.rawText);
  const maskedName = maskName(member.name);
  const matchedPayAmount = matchedBills.reduce((sum, row) => sum + row.payAmount, 0);
  const recognizedSideRows = matchedTechMarketRows.filter(
    (row) => classifyAddonCategory(row) !== "service",
  );
  const waterbarSignal = buildWaterbarSignal(matchedBills);
  const currentStoredAmount = narrativeSnapshot?.currentStoredAmount ?? member.storedAmount;
  const currentLastConsumeTime = narrativeSnapshot?.currentLastConsumeTime ?? member.lastConsumeTime;
  const currentSilentDays = narrativeSnapshot?.currentSilentDays ?? member.silentDays;
  const customerGrade = resolveCustomerGrade({
    member,
    snapshot: narrativeSnapshot,
    matchedBillCount: matchedBills.length,
    matchedPayAmount,
  });
  const lifecycleStage = resolveLifecycleStage({
    member,
    snapshot: narrativeSnapshot,
  });
  const businessSignal = evaluateCustomerBusinessScore({
    primarySegment: narrativeSnapshot?.primarySegment,
    paymentSegment: narrativeSnapshot?.paymentSegment,
    techLoyaltySegment: narrativeSnapshot?.techLoyaltySegment,
    payAmount90d: narrativeSnapshot?.payAmount90d ?? matchedPayAmount,
    visitCount90d: narrativeSnapshot?.visitCount90d ?? matchedBills.length,
    silentDays: currentSilentDays,
  });
  const managerActionPlan = buildManagerActionPlan({
    member,
    snapshot: narrativeSnapshot,
    techMap,
    projectMap,
    visitBucketMap,
    dayBucketMap,
    businessSignal,
    matchedBillCount: matchedBills.length,
    timeZone: params.config.timeZone,
    now: params.now ?? new Date(),
  });

  if (focus === "tech") {
    return [
      `${storeName} 尾号${suffix} ${maskedName} 偏好技师`,
      ...topLines("偏好技师", techMap, 3),
    ].join("\n");
  }

  if (focus === "project") {
    return [
      `${storeName} 尾号${suffix} ${maskedName} 偏好项目`,
      ...topLines("偏好项目", projectMap, 3),
    ].join("\n");
  }

  if (focus === "tea") {
    return [
      `${storeName} 尾号${suffix} ${maskedName} 茶饮偏好`,
      ...topLines(
        "茶饮偏好",
        teaMap,
        3,
        buildSpecialtyPreferenceEmptyMessage({
          focus: "tea",
          matchedTechMarketRows,
          recognizedSideRows,
        }),
      ),
    ].join("\n");
  }

  if (focus === "meal") {
    return [
      `${storeName} 尾号${suffix} ${maskedName} 餐食偏好`,
      ...topLines(
        "餐食偏好",
        mealMap,
        3,
        buildSpecialtyPreferenceEmptyMessage({
          focus: "meal",
          matchedTechMarketRows,
          recognizedSideRows,
        }),
      ),
    ].join("\n");
  }

  if (focus === "addon") {
    return [
      `${storeName} 尾号${suffix} ${maskedName} 副项偏好`,
      ...topLines(
        "副项偏好",
        addonMap,
        3,
        buildSpecialtyPreferenceEmptyMessage({
          focus: "addon",
          matchedTechMarketRows,
          recognizedSideRows,
        }),
      ),
    ].join("\n");
  }

  if (focus === "waterbar") {
    return renderWaterbarDetail({
      storeName,
      suffix,
      maskedName,
      signal: waterbarSignal,
      timeFrameLabel: params.intent.timeFrame.label,
    });
  }

  const groupbuySummary = buildGroupbuyConversionSummary(narrativeSnapshot);
  const topVisitBucket = topPreferenceName(visitBucketMap);
  const topDayBucket = topPreferenceName(dayBucketMap);
  const topTea = rankPreferences(teaMap)[0];
  const topMeal = rankPreferences(mealMap)[0];
  const topAddon = rankPreferences(addonMap)[0];
  const rankedPayments = rankPreferences(paymentMap);
  const topPayment = rankedPayments[0];
  const secondPayment = rankedPayments[1];
  const paymentHabit =
    topPayment && secondPayment
      ? `${topPayment.name}为主，偶尔用${secondPayment.name}补差`
      : topPayment
        ? `以${topPayment.name}支付为主`
        : undefined;

  const lines = [`${storeName} 尾号${suffix} 客户画像`];
  appendSection(lines, "一句话判断", [
    buildManagerSummaryLine({
      businessSignal,
      topTech: managerActionPlan.topTech,
      topProject: managerActionPlan.topProject,
    }),
  ]);
  appendSection(lines, "当前状态", [
    `会员：${maskedName}`,
    `储值余额 ${formatCurrency(currentStoredAmount)}｜最近到店 ${currentLastConsumeTime ?? "暂无到店记录"}｜沉默 ${currentSilentDays} 天`,
    `查询窗口 ${params.intent.timeFrame.label}｜匹配到店 ${matchedBills.length} 次｜累计支付 ${formatCurrency(
      matchedPayAmount,
    )}`,
  ]);
  appendSection(
    lines,
    "顾客价值",
    [
      `客户等级：${customerGrade.label}`,
      `生命周期：${lifecycleStage.label}`,
      `近30/90天节奏：${summarizeCadence({
        snapshot: narrativeSnapshot,
        matchedBills,
        snapshotBizDate,
      })}`,
      `经营分层：${businessSignal.tierLabel}`,
      businessSignal.tags.length > 0 ? `经营标签：${businessSignal.tags.join("、")}` : "",
      groupbuySummary ? `团购承接：${groupbuySummary}` : "",
    ].filter(Boolean),
  );
  appendSection(
    lines,
    "偏好与习惯",
    [
      managerActionPlan.topTech ? `偏好技师：${managerActionPlan.topTech}` : "",
      managerActionPlan.topProject ? `偏好项目：${managerActionPlan.topProject}` : "",
      paymentHabit ? `支付习惯：${paymentHabit}` : "",
      topVisitBucket ? `常来时段：${topVisitBucket}` : "",
      topDayBucket ? `常来日期：${topDayBucket}` : "",
      topTea ? `茶饮偏好：${topTea.name} ${topTea.count} 次 ${formatCurrency(topTea.amount)}` : "",
      topMeal ? `餐食偏好：${topMeal.name} ${topMeal.count} 次 ${formatCurrency(topMeal.amount)}` : "",
      topAddon ? `副项偏好：${topAddon.name} ${topAddon.count} 次 ${formatCurrency(topAddon.amount)}` : "",
    ].filter(Boolean),
  );
  appendSection(lines, "风险与机会", [
    `沉默风险：${managerActionPlan.silentRisk.label}，${managerActionPlan.silentRisk.reason}`,
    `当前机会：${managerActionPlan.opportunity}`,
    `支付结构判断：${buildPaymentStructureDiagnosis({
      paymentMap,
      snapshot: narrativeSnapshot,
    })}`,
    `当前触达建议：${managerActionPlan.touchAdvice}`,
    `回访话术：${managerActionPlan.followupScript}`,
    `推荐触达渠道：${managerActionPlan.touchChannel}`,
    `预计复购概率：${managerActionPlan.repurchaseProbability.label}（${managerActionPlan.repurchaseProbability.reason}）`,
  ]);
  return lines.join("\n");
}
