import { getStoreByOrgId } from "./config.js";
import {
  extractConsumeCustomerIdentityKeys,
  extractConsumeCustomerRefs,
} from "./customer-intelligence.js";
import { HetangOpsStore } from "./store.js";
import {
  resolveOperationalBizDateCompletionIso,
  resolveOperationalBizDateFromTimestamp,
  shiftBizDate,
} from "./time.js";
import {
  type ConsumeBillRecord,
  type DailyGroupbuyPlatformMetric,
  type DailyStoreAlert,
  type DailyStoreMetrics,
  type HetangOpsConfig,
  type MemberCardDailySnapshotRecord,
  type MemberCardCurrentRecord,
  type MemberDailySnapshotRecord,
  type MemberCurrentRecord,
  type RechargeBillRecord,
  type UserTradeRecord,
} from "./types.js";

const GROUPBUY_PAYMENT_NAMES = new Set(["美团", "抖音", "美团团购", "抖音团购"]);
const GROUPBUY_PLATFORM_ORDER = ["美团", "抖音"] as const;
const REQUIRED_SYNC_ENDPOINTS = ["1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8"] as const;

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function percent(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return numerator / denominator;
}

function formatPercent(value: number | null): string {
  if (value === null) {
    return "N/A";
  }
  return `${round(value * 100, 1)}%`;
}

function normalizeText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function normalizeIdentityValue(value: string | undefined): string | undefined {
  const normalized = normalizeText(value)?.toLowerCase();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function uniqueSorted(values: Iterable<string | undefined>): string[] {
  return Array.from(
    new Set(Array.from(values).filter((value): value is string => Boolean(value))),
  ).sort((left, right) => left.localeCompare(right));
}

function parseRawRecord(rawJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(rawJson) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function extractTechCurrentStateName(rawJson: string): string | undefined {
  const raw = parseRawRecord(rawJson);
  return typeof raw.PersonStateName === "string" ? normalizeText(raw.PersonStateName) : undefined;
}

function isOnDutyTechRecord(params: {
  isJob: boolean;
  isWork: boolean;
  rawJson: string;
}): boolean {
  if (!params.isJob || !params.isWork) {
    return false;
  }
  const stateName = extractTechCurrentStateName(params.rawJson);
  if (!stateName) {
    return true;
  }
  return !/(下班|休假)/u.test(stateName);
}

function parseTimestampMs(value: string | undefined): number | null {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }
  const isoLike =
    /[zZ]$/u.test(normalized) || /[+-]\d{2}:\d{2}$/u.test(normalized)
      ? normalized.replace(" ", "T")
      : `${normalized.replace(" ", "T")}Z`;
  const timestamp = Date.parse(isoLike);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function buildMemberIdentityIndexes(params: {
  currentMembers: MemberIdentityRecord[];
  currentMemberCards: MemberCardIdentityRecord[];
}): MemberIdentityIndexes {
  const memberById = new Map<string, MemberIdentityRecord>();
  const memberIdByPhone = new Map<string, string>();
  const memberIdByCardNo = new Map<string, string>();
  const memberIdByCardId = new Map<string, string>();
  const memberIdsByName = new Map<string, string[]>();

  for (const member of params.currentMembers) {
    memberById.set(member.memberId, member);

    const phone = normalizeIdentityValue(member.phone);
    if (phone) {
      memberIdByPhone.set(phone, member.memberId);
    }

    const name = normalizeIdentityValue(member.name);
    if (name) {
      const ids = memberIdsByName.get(name) ?? [];
      ids.push(member.memberId);
      memberIdsByName.set(name, ids);
    }
  }

  for (const card of params.currentMemberCards) {
    const cardNo = normalizeIdentityValue(card.cardNo);
    if (cardNo) {
      memberIdByCardNo.set(cardNo, card.memberId);
    }
    const cardId = normalizeIdentityValue(card.cardId);
    if (cardId) {
      memberIdByCardId.set(cardId, card.memberId);
    }
  }

  return {
    memberById,
    memberIdByPhone,
    memberIdByCardNo,
    memberIdByCardId,
    memberIdsByName,
  };
}

function resolveMemberIdFromIdentity(params: {
  indexes: MemberIdentityIndexes;
  referenceCode?: string;
  cardId?: string;
  displayName?: string;
}): string | undefined {
  const normalizedReferenceCode = normalizeIdentityValue(params.referenceCode);
  if (normalizedReferenceCode) {
    const memberId =
      params.indexes.memberIdByCardNo.get(normalizedReferenceCode) ??
      params.indexes.memberIdByPhone.get(normalizedReferenceCode);
    if (memberId) {
      return memberId;
    }
  }

  const normalizedCardId = normalizeIdentityValue(params.cardId);
  if (normalizedCardId) {
    const memberId = params.indexes.memberIdByCardId.get(normalizedCardId);
    if (memberId) {
      return memberId;
    }
  }

  const normalizedName = normalizeIdentityValue(params.displayName);
  if (normalizedName) {
    const memberIds = params.indexes.memberIdsByName.get(normalizedName);
    if (memberIds?.length === 1) {
      return memberIds[0];
    }
  }

  return undefined;
}

function resolveCanonicalCustomerKey(params: {
  indexes: MemberIdentityIndexes;
  referenceCode?: string;
  cardId?: string;
  displayName?: string;
}): string | undefined {
  const memberId = resolveMemberIdFromIdentity(params);
  if (memberId) {
    return `member:${memberId}`;
  }

  const normalizedReferenceCode = normalizeIdentityValue(params.referenceCode);
  if (normalizedReferenceCode) {
    return `customer-ref:${normalizedReferenceCode}`;
  }

  const normalizedCardId = normalizeIdentityValue(params.cardId);
  if (normalizedCardId) {
    return `customer-ref:${normalizedCardId}`;
  }

  const normalizedName = normalizeIdentityValue(params.displayName);
  if (normalizedName) {
    return `display-name:${normalizedName}`;
  }

  return undefined;
}

function extractCanonicalConsumeCustomerKeys(
  rawJson: string,
  indexes: MemberIdentityIndexes,
): string[] {
  const refs = extractConsumeCustomerRefs(rawJson);
  if (refs.length === 0) {
    const parsed = parseRawRecord(rawJson);
    return uniqueSorted([
      resolveCanonicalCustomerKey({
        indexes,
        referenceCode:
          String(parsed.MemberPhone ?? parsed.Phone ?? parsed.CardNo ?? "").trim() || undefined,
        cardId: String(parsed.CardId ?? "").trim() || undefined,
        // Live groupbuy rows often populate CCode/CName with front-desk staff info.
        displayName: String(parsed.MemberName ?? "").trim() || undefined,
      }),
    ]);
  }

  return uniqueSorted(
    refs.map((ref) =>
      resolveCanonicalCustomerKey({
        indexes,
        referenceCode: ref.referenceCode,
        displayName: ref.displayName,
      }),
    ),
  );
}

function extractCanonicalRechargeCustomerKey(
  rawJson: string,
  indexes: MemberIdentityIndexes,
): string | undefined {
  const parsed = parseRawRecord(rawJson);
  return resolveCanonicalCustomerKey({
    indexes,
    referenceCode:
      String(parsed.MemberPhone ?? parsed.CardNo ?? parsed.Phone ?? "").trim() || undefined,
    cardId: String(parsed.CardId ?? "").trim() || undefined,
    displayName: String(parsed.MemberName ?? parsed.Name ?? "").trim() || undefined,
  });
}

function extractTradeMemberId(rawJson: string, indexes: MemberIdentityIndexes): string | undefined {
  const parsed = parseRawRecord(rawJson);
  return resolveMemberIdFromIdentity({
    indexes,
    referenceCode:
      String(parsed.MemberPhone ?? parsed.CardNo ?? parsed.Phone ?? "").trim() || undefined,
    cardId: String(parsed.CardId ?? "").trim() || undefined,
    displayName: String(parsed.MemberName ?? parsed.Name ?? "").trim() || undefined,
  });
}

function percentile(values: number[], quantile: number): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 1) {
    return sorted[0];
  }
  const position = Math.min(Math.max(quantile, 0), 1) * (sorted.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  if (lowerIndex === upperIndex) {
    return sorted[lowerIndex] ?? null;
  }
  const lower = sorted[lowerIndex] ?? sorted[0] ?? 0;
  const upper = sorted[upperIndex] ?? sorted[sorted.length - 1] ?? lower;
  return lower + (upper - lower) * (position - lowerIndex);
}

function computeMemberFollowupMetrics(params: {
  members: MemberIdentityRecord[];
  memberCards: MemberCardIdentityRecord[];
  rechargeHistory: RechargeBillRecord[];
  userTradeHistory: UserTradeRecord[];
}): {
  highBalanceSleepingMemberCount: number;
  highBalanceSleepingMemberAmount: number;
  firstChargeUnconsumedMemberCount: number;
  firstChargeUnconsumedMemberAmount: number;
} {
  const positiveStoredBalances = params.members
    .map((member) => member.storedAmount)
    .filter((value) => value > 0);
  const highBalanceThreshold = Math.max(1000, percentile(positiveStoredBalances, 0.8) ?? 0);
  const highBalanceSleepingMembers = params.members.filter(
    (member) => member.silentDays >= 90 && member.storedAmount >= highBalanceThreshold,
  );

  const indexes = buildMemberIdentityIndexes({
    currentMembers: params.members,
    currentMemberCards: params.memberCards,
  });
  const firstRechargeAtByMember = new Map<string, number>();

  for (const recharge of params.rechargeHistory) {
    if (recharge.antiFlag || recharge.totalAmount <= 0) {
      continue;
    }
    const memberKey = extractCanonicalRechargeCustomerKey(recharge.rawJson, indexes);
    if (!memberKey?.startsWith("member:")) {
      continue;
    }
    const memberId = memberKey.slice("member:".length);
    const timeMs = parseTimestampMs(recharge.optTime);
    if (timeMs === null) {
      continue;
    }
    const current = firstRechargeAtByMember.get(memberId);
    if (current === undefined || timeMs < current) {
      firstRechargeAtByMember.set(memberId, timeMs);
    }
  }

  const consumedAfterFirstRecharge = new Set<string>();
  for (const trade of params.userTradeHistory) {
    if (trade.antiFlag || trade.changeBalance >= 0) {
      continue;
    }
    const memberId = extractTradeMemberId(trade.rawJson, indexes);
    if (!memberId) {
      continue;
    }
    const firstRechargeAt = firstRechargeAtByMember.get(memberId);
    if (firstRechargeAt === undefined) {
      continue;
    }
    const tradeTimeMs = parseTimestampMs(trade.optTime);
    if (tradeTimeMs === null || tradeTimeMs < firstRechargeAt) {
      continue;
    }
    consumedAfterFirstRecharge.add(memberId);
  }

  const firstChargeUnconsumedMembers = params.members.filter((member) => {
    if (member.storedAmount <= 0) {
      return false;
    }
    return (
      firstRechargeAtByMember.has(member.memberId) &&
      !consumedAfterFirstRecharge.has(member.memberId)
    );
  });

  return {
    highBalanceSleepingMemberCount: highBalanceSleepingMembers.length,
    highBalanceSleepingMemberAmount: round(
      highBalanceSleepingMembers.reduce((sum, member) => sum + member.storedAmount, 0),
    ),
    firstChargeUnconsumedMemberCount: firstChargeUnconsumedMembers.length,
    firstChargeUnconsumedMemberAmount: round(
      firstChargeUnconsumedMembers.reduce((sum, member) => sum + member.storedAmount, 0),
    ),
  };
}

type ParsedPayment = {
  name: string;
  amount: number;
  paymentType: number | null;
};

type GroupbuyCustomerEvent = {
  customerKey: string;
  optTime: string;
  isGroupbuy: boolean;
  isMemberPay: boolean;
};

type GroupbuyTimelineEvent = GroupbuyCustomerEvent & {
  settleKey: string;
  timeMs: number;
  payAmount: number;
  memberPayAmount: number;
};

type MemberIdentityRecord = Pick<
  MemberCurrentRecord,
  | "memberId"
  | "name"
  | "phone"
  | "storedAmount"
  | "consumeAmount"
  | "createdTime"
  | "lastConsumeTime"
  | "silentDays"
>;

type MemberCardIdentityRecord = Pick<MemberCardCurrentRecord, "memberId" | "cardId" | "cardNo">;

type GroupbuyCohortMetrics = {
  groupbuyCohortCustomerCount: number;
  groupbuyRevisitCustomerCount: number;
  groupbuyRevisitRate: number | null;
  groupbuyMemberPayConvertedCustomerCount: number;
  groupbuyMemberPayConversionRate: number | null;
  groupbuy7dRevisitCustomerCount: number;
  groupbuy7dRevisitRate: number | null;
  groupbuy7dCardOpenedCustomerCount: number;
  groupbuy7dCardOpenedRate: number | null;
  groupbuy7dStoredValueConvertedCustomerCount: number;
  groupbuy7dStoredValueConversionRate: number | null;
  groupbuy30dMemberPayConvertedCustomerCount: number;
  groupbuy30dMemberPayConversionRate: number | null;
  groupbuyFirstOrderCustomerCount: number;
  groupbuyFirstOrderHighValueMemberCustomerCount: number;
  groupbuyFirstOrderHighValueMemberRate: number | null;
};

type MemberIdentityIndexes = {
  memberById: Map<string, MemberIdentityRecord>;
  memberIdByPhone: Map<string, string>;
  memberIdByCardNo: Map<string, string>;
  memberIdByCardId: Map<string, string>;
  memberIdsByName: Map<string, string[]>;
};

function extractPayments(rawJson: string): ParsedPayment[] {
  try {
    const parsed = JSON.parse(rawJson) as { Payments?: Array<Record<string, unknown>> };
    if (!Array.isArray(parsed.Payments)) {
      return [];
    }
    return parsed.Payments.reduce<ParsedPayment[]>((list, payment) => {
      const name = String(payment.Name ?? "").trim();
      const amount = Number(payment.Amount ?? 0);
      const paymentTypeRaw = Number(payment.PaymentType);
      if (!name || !Number.isFinite(amount)) {
        return list;
      }
      list.push({
        name,
        amount,
        paymentType: Number.isFinite(paymentTypeRaw) ? paymentTypeRaw : null,
      });
      return list;
    }, []);
  } catch {
    return [];
  }
}

function extractPaymentAmount(
  rawJson: string,
  matcher: (payment: ParsedPayment) => boolean,
): number {
  return round(
    extractPayments(rawJson).reduce((sum, payment) => {
      if (!matcher(payment)) {
        return sum;
      }
      return sum + payment.amount;
    }, 0),
  );
}

function isMemberPayment(payment: ParsedPayment): boolean {
  return payment.paymentType === 3 || payment.name === "会员" || payment.name.includes("会员");
}

function isCashPayment(payment: ParsedPayment): boolean {
  return payment.paymentType === 1 || payment.name.includes("现金");
}

function isWechatPayment(payment: ParsedPayment): boolean {
  return payment.paymentType === 4 || payment.name.includes("微信");
}

function isAlipayPayment(payment: ParsedPayment): boolean {
  return payment.paymentType === 11 || payment.name.includes("支付宝");
}

function isGroupbuyPayment(payment: ParsedPayment): boolean {
  return GROUPBUY_PAYMENT_NAMES.has(payment.name);
}

function extractMemberPaymentAmount(rawJson: string): number {
  return extractPaymentAmount(rawJson, isMemberPayment);
}

function extractCashPaymentAmount(rawJson: string): number {
  return extractPaymentAmount(rawJson, isCashPayment);
}

function extractWechatPaymentAmount(rawJson: string): number {
  return extractPaymentAmount(rawJson, isWechatPayment);
}

function extractAlipayPaymentAmount(rawJson: string): number {
  return extractPaymentAmount(rawJson, isAlipayPayment);
}

function extractGroupbuyPaymentAmount(rawJson: string): number {
  return extractPaymentAmount(rawJson, isGroupbuyPayment);
}

function normalizeClockType(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function isPointClockRecord(params: { clockType?: string; rawJson: string }): boolean {
  const normalized = normalizeClockType(params.clockType);
  if (
    normalized === "2" ||
    normalized === "point" ||
    normalized === "点钟" ||
    normalized === "pointclock"
  ) {
    return true;
  }
  try {
    const parsed = JSON.parse(params.rawJson) as { ClockType?: unknown };
    const raw = normalizeClockType(String(parsed.ClockType ?? ""));
    return raw === "2" || raw === "point" || raw === "点钟" || raw === "pointclock";
  } catch {
    return false;
  }
}

function isAddClockRecord(rawJson: string): boolean {
  try {
    const parsed = JSON.parse(rawJson) as { AddClockType?: unknown };
    const raw = String(parsed.AddClockType ?? "")
      .trim()
      .toLowerCase();
    return raw.length > 0 && raw !== "0" && raw !== "false" && raw !== "null";
  } catch {
    return false;
  }
}

function normalizeGroupbuyPlatform(name: string): string | null {
  if (name === "美团" || name === "美团团购") {
    return "美团";
  }
  if (name === "抖音" || name === "抖音团购") {
    return "抖音";
  }
  return null;
}

function buildGroupbuyPlatformBreakdown(params: {
  consume: Array<{ antiFlag: boolean; rawJson: string }>;
  serviceOrderCount: number;
  serviceRevenue: number;
}): DailyGroupbuyPlatformMetric[] {
  const totals = new Map<string, { orderCount: number; amount: number }>();
  for (const row of params.consume) {
    if (row.antiFlag) {
      continue;
    }
    const perPlatformAmount = new Map<string, number>();
    for (const payment of extractPayments(row.rawJson)) {
      const platform = normalizeGroupbuyPlatform(payment.name);
      if (!platform) {
        continue;
      }
      perPlatformAmount.set(platform, (perPlatformAmount.get(platform) ?? 0) + payment.amount);
    }
    for (const [platform, amount] of perPlatformAmount.entries()) {
      const current = totals.get(platform) ?? { orderCount: 0, amount: 0 };
      current.orderCount += 1;
      current.amount = round(current.amount + amount);
      totals.set(platform, current);
    }
  }

  return GROUPBUY_PLATFORM_ORDER.filter((platform) => totals.has(platform)).map((platform) => {
    const current = totals.get(platform)!;
    return {
      platform,
      orderCount: current.orderCount,
      orderShare: percent(current.orderCount, params.serviceOrderCount),
      amount: round(current.amount),
      amountShare: percent(current.amount, params.serviceRevenue),
    };
  });
}

function buildGroupbuyCohortMetrics(params: {
  consume: ConsumeBillRecord[];
  recharge: RechargeBillRecord[];
  currentMembers: MemberIdentityRecord[];
  currentMemberCards: MemberCardIdentityRecord[];
}): GroupbuyCohortMetrics {
  const indexes = buildMemberIdentityIndexes({
    currentMembers: params.currentMembers,
    currentMemberCards: params.currentMemberCards,
  });

  const memberCreatedAtByCustomer = new Map<string, number>();
  for (const member of params.currentMembers) {
    const createdAt = parseTimestampMs(member.createdTime);
    if (createdAt !== null) {
      memberCreatedAtByCustomer.set(`member:${member.memberId}`, createdAt);
    }
  }

  const rechargeTimesByCustomer = new Map<string, number[]>();
  for (const row of params.recharge) {
    if (row.antiFlag) {
      continue;
    }
    const customerKey = extractCanonicalRechargeCustomerKey(row.rawJson, indexes);
    const timeMs = parseTimestampMs(row.optTime);
    if (!customerKey || timeMs === null) {
      continue;
    }
    const times = rechargeTimesByCustomer.get(customerKey) ?? [];
    times.push(timeMs);
    rechargeTimesByCustomer.set(customerKey, times);
  }

  const eventsByCustomer = new Map<string, GroupbuyTimelineEvent[]>();
  for (const row of params.consume) {
    if (row.antiFlag) {
      continue;
    }

    const timeMs = parseTimestampMs(row.optTime) ?? parseTimestampMs(`${row.bizDate} 00:00:00`);
    if (timeMs === null) {
      continue;
    }

    const canonicalCustomerKeys = extractCanonicalConsumeCustomerKeys(row.rawJson, indexes);
    const customerKeys =
      canonicalCustomerKeys.length > 0
        ? canonicalCustomerKeys
        : extractConsumeCustomerIdentityKeys(row.rawJson);
    if (customerKeys.length === 0) {
      continue;
    }

    const settleKey = row.settleNo ?? row.settleId;
    const isGroupbuy = extractGroupbuyPaymentAmount(row.rawJson) > 0;
    const memberPayAmount = extractMemberPaymentAmount(row.rawJson);

    for (const customerKey of customerKeys) {
      const events = eventsByCustomer.get(customerKey) ?? [];
      events.push({
        customerKey,
        settleKey,
        optTime: row.optTime,
        timeMs,
        payAmount: row.payAmount,
        isGroupbuy,
        memberPayAmount,
        isMemberPay: memberPayAmount > 0,
      });
      eventsByCustomer.set(customerKey, events);
    }
  }

  const sevenDayWindowMs = 7 * 24 * 60 * 60 * 1000;
  const thirtyDayWindowMs = 30 * 24 * 60 * 60 * 1000;

  let cohortCount = 0;
  let revisitCount = 0;
  let memberPayConvertedCount = 0;
  let revisit7dCount = 0;
  let cardOpened7dCount = 0;
  let storedValue7dCount = 0;
  let memberPay30dCount = 0;
  let firstOrderCount = 0;
  let firstOrderHighValueCount = 0;

  for (const events of eventsByCustomer.values()) {
    events.sort((left, right) => {
      if (left.timeMs !== right.timeMs) {
        return left.timeMs - right.timeMs;
      }
      return left.settleKey.localeCompare(right.settleKey);
    });

    const firstGroupbuy = events.find((event) => event.isGroupbuy);
    if (!firstGroupbuy) {
      continue;
    }

    cohortCount += 1;
    const laterEvents = events.filter((event) => event.timeMs > firstGroupbuy.timeMs);
    if (laterEvents.length > 0) {
      revisitCount += 1;
    }
    if (laterEvents.some((event) => event.isMemberPay)) {
      memberPayConvertedCount += 1;
    }

    const eventsWithin7d = laterEvents.filter(
      (event) => event.timeMs - firstGroupbuy.timeMs <= sevenDayWindowMs,
    );
    const rechargeTimes = rechargeTimesByCustomer.get(firstGroupbuy.customerKey) ?? [];
    const hasRechargeWithin7d = rechargeTimes.some(
      (timeMs) =>
        timeMs >= firstGroupbuy.timeMs && timeMs - firstGroupbuy.timeMs <= sevenDayWindowMs,
    );
    const memberCreatedAt = memberCreatedAtByCustomer.get(firstGroupbuy.customerKey);
    const hasMemberCreatedWithin7d =
      memberCreatedAt !== undefined &&
      memberCreatedAt >= firstGroupbuy.timeMs &&
      memberCreatedAt - firstGroupbuy.timeMs <= sevenDayWindowMs;

    if (eventsWithin7d.length > 0) {
      revisit7dCount += 1;
    }
    if (
      eventsWithin7d.some((event) => event.isMemberPay) ||
      hasMemberCreatedWithin7d ||
      hasRechargeWithin7d
    ) {
      cardOpened7dCount += 1;
    }
    if (hasRechargeWithin7d) {
      storedValue7dCount += 1;
    }

    const eventsWithin30d = laterEvents.filter(
      (event) => event.timeMs - firstGroupbuy.timeMs <= thirtyDayWindowMs,
    );
    if (eventsWithin30d.some((event) => event.isMemberPay)) {
      memberPay30dCount += 1;
    }

    const firstObservedEvent = events[0];
    if (firstObservedEvent?.isGroupbuy) {
      firstOrderCount += 1;
      const customerWindowEvents = events.filter(
        (event) =>
          event.timeMs >= firstGroupbuy.timeMs &&
          event.timeMs - firstGroupbuy.timeMs <= thirtyDayWindowMs,
      );
      const visitCount = new Set(customerWindowEvents.map((event) => event.settleKey)).size;
      const payAmount = round(
        customerWindowEvents.reduce((sum, event) => sum + event.payAmount, 0),
      );
      const memberPayAmount = round(
        customerWindowEvents.reduce((sum, event) => sum + event.memberPayAmount, 0),
      );
      if (visitCount >= 4 && payAmount >= 1000 && memberPayAmount > 0) {
        firstOrderHighValueCount += 1;
      }
    }
  }

  return {
    groupbuyCohortCustomerCount: cohortCount,
    groupbuyRevisitCustomerCount: revisitCount,
    groupbuyRevisitRate: percent(revisitCount, cohortCount),
    groupbuyMemberPayConvertedCustomerCount: memberPayConvertedCount,
    groupbuyMemberPayConversionRate: percent(memberPayConvertedCount, cohortCount),
    groupbuy7dRevisitCustomerCount: revisit7dCount,
    groupbuy7dRevisitRate: percent(revisit7dCount, cohortCount),
    groupbuy7dCardOpenedCustomerCount: cardOpened7dCount,
    groupbuy7dCardOpenedRate: percent(cardOpened7dCount, cohortCount),
    groupbuy7dStoredValueConvertedCustomerCount: storedValue7dCount,
    groupbuy7dStoredValueConversionRate: percent(storedValue7dCount, cohortCount),
    groupbuy30dMemberPayConvertedCustomerCount: memberPay30dCount,
    groupbuy30dMemberPayConversionRate: percent(memberPay30dCount, cohortCount),
    groupbuyFirstOrderCustomerCount: firstOrderCount,
    groupbuyFirstOrderHighValueMemberCustomerCount: firstOrderHighValueCount,
    groupbuyFirstOrderHighValueMemberRate: percent(firstOrderHighValueCount, firstOrderCount),
  };
}

function computeCostMetrics(params: {
  serviceRevenue: number;
  techCommission: number;
  storeVariableCostRate?: number;
  storeMaterialCostRate?: number;
  storeFixedMonthlyCost?: number;
}) {
  const unavailable: string[] = [];
  const variableCostRate = params.storeVariableCostRate;
  const materialCostRate = params.storeMaterialCostRate;
  const fixedMonthlyCost = params.storeFixedMonthlyCost;

  if (
    variableCostRate === undefined &&
    materialCostRate === undefined &&
    fixedMonthlyCost === undefined
  ) {
    unavailable.push("毛利/净利/保本点");
    return {
      grossMarginRate: null,
      netMarginRate: null,
      breakEvenRevenue: null,
      unavailable,
    };
  }

  const additionalVariableCost =
    params.serviceRevenue * ((variableCostRate ?? 0) + (materialCostRate ?? 0));
  const totalVariableCost = params.techCommission + additionalVariableCost;
  const grossMarginRate =
    params.serviceRevenue > 0
      ? (params.serviceRevenue - totalVariableCost) / params.serviceRevenue
      : null;
  const netMarginRate =
    params.serviceRevenue > 0 && fixedMonthlyCost !== undefined
      ? (params.serviceRevenue - totalVariableCost - fixedMonthlyCost / 30) / params.serviceRevenue
      : null;
  const breakEvenRevenue =
    fixedMonthlyCost !== undefined && grossMarginRate && grossMarginRate > 0
      ? fixedMonthlyCost / grossMarginRate
      : null;

  if (fixedMonthlyCost === undefined) {
    unavailable.push("净利/保本点");
  }

  return {
    grossMarginRate,
    netMarginRate,
    breakEvenRevenue,
    unavailable,
  };
}

function computeRoomMetrics(params: {
  serviceOrderCount: number;
  totalClockCount: number;
  roomCount?: number;
  operatingHoursPerDay?: number;
}) {
  if (!params.roomCount || !params.operatingHoursPerDay) {
    return {
      roomOccupancyRate: null,
      roomTurnoverRate: null,
      unavailable: ["包间上座率/翻房率"],
    };
  }

  return {
    roomOccupancyRate: percent(
      params.totalClockCount,
      params.roomCount * params.operatingHoursPerDay,
    ),
    roomTurnoverRate: percent(params.serviceOrderCount, params.roomCount),
    unavailable: [] as string[],
  };
}

function buildAlerts(params: {
  config: HetangOpsConfig;
  metrics: DailyStoreMetrics;
  previousMetrics: DailyStoreMetrics | null;
}): DailyStoreAlert[] {
  const alerts: DailyStoreAlert[] = [];
  if (params.metrics.incompleteSync) {
    alerts.push({
      code: "data-gap",
      severity: "critical",
      message: formatStaleSyncAlertMessage(params.metrics.staleSyncEndpoints),
    });
  }

  if (params.metrics.serviceRevenue <= 0 && params.metrics.totalClockCount <= 0) {
    alerts.push({
      code: "no-activity",
      severity: "critical",
      message: "昨日服务营收和上钟次数都为 0，需优先排查同步缺口或门店停业。",
    });
  }

  if (params.previousMetrics?.serviceRevenue && params.previousMetrics.serviceRevenue > 0) {
    const decline = 1 - params.metrics.serviceRevenue / params.previousMetrics.serviceRevenue;
    if (decline >= params.config.analysis.revenueDropAlertThreshold) {
      alerts.push({
        code: "revenue-drop",
        severity: "warn",
        message: `服务营收较前日下滑 ${round(decline * 100, 1)}%，建议先从总钟数和异常冲正排查。`,
      });
    }
  }

  if (params.previousMetrics?.totalClockCount && params.previousMetrics.totalClockCount > 0) {
    const decline = 1 - params.metrics.totalClockCount / params.previousMetrics.totalClockCount;
    if (decline >= params.config.analysis.clockDropAlertThreshold) {
      alerts.push({
        code: "clock-drop",
        severity: "warn",
        message: `总钟数较前日下滑 ${round(decline * 100, 1)}%，要复核客流分配和高峰排班。`,
      });
    }
  }

  const antiRatio = percent(
    params.metrics.antiServiceRevenue,
    params.metrics.serviceRevenue + params.metrics.antiServiceRevenue,
  );
  if (antiRatio !== null && antiRatio >= params.config.analysis.antiRatioAlertThreshold) {
    alerts.push({
      code: "anti-ratio-high",
      severity: "warn",
      message: `冲减/反结金额占比达到 ${formatPercent(antiRatio)}，需核对异常退款与冲正原因。`,
    });
  }

  if (
    params.metrics.activeTechCount <= params.config.analysis.lowTechActiveCountThreshold ||
    (params.metrics.onDutyTechCount > 0 && params.metrics.totalClockCount <= 0)
  ) {
    alerts.push({
      code: "low-tech-activity",
      severity: "warn",
      message: "在岗技师未形成有效产能，建议优先检查排班、前台分单和高峰承接。",
    });
  }

  if (
    params.metrics.storedConsumeRate !== null &&
    params.metrics.storedConsumeRate < params.config.analysis.lowStoredConsumeRateThreshold
  ) {
    alerts.push({
      code: "stored-consume-low",
      severity: "warn",
      message: `储值耗卡/充值比仅 ${formatPercent(params.metrics.storedConsumeRate)}，存在偏重充值、轻消耗的预付风险。`,
    });
  }

  if (
    params.metrics.sleepingMemberRate !== null &&
    params.metrics.sleepingMemberRate >= params.config.analysis.sleepingMemberRateAlertThreshold
  ) {
    alerts.push({
      code: "sleeping-members-high",
      severity: "warn",
      message: `沉默会员占比 ${formatPercent(params.metrics.sleepingMemberRate)}，建议尽快做 90 天未到店会员召回。`,
    });
  }

  if (params.metrics.techCommissionRate >= params.config.analysis.highTechCommissionRateThreshold) {
    alerts.push({
      code: "tech-commission-high",
      severity: "info",
      message: `技师提成占比 ${formatPercent(params.metrics.techCommissionRate)}，需复核项目提成与低毛利项目折扣。`,
    });
  }

  if (params.metrics.groupbuyOrderShare !== null && params.metrics.groupbuyOrderShare > 0.4) {
    alerts.push({
      code: "groupbuy-share-high",
      severity: "warn",
      message: `团购订单占比达到 ${formatPercent(params.metrics.groupbuyOrderShare)}，需重点盯 7 天复到店、开卡、储值和 30 天会员消费转化，避免只做低毛利引流。`,
    });
  }

  return alerts;
}

function buildSuggestions(metrics: DailyStoreMetrics, alerts: DailyStoreAlert[]): string[] {
  const suggestions: string[] = [];
  const alertSet = new Set(alerts.map((entry) => entry.code));

  if (alertSet.has("data-gap")) {
    suggestions.push("先补齐 8 个接口同步，再发布正式经营结论，避免因为数据断层做错动作。");
  }
  if (alertSet.has("revenue-drop")) {
    suggestions.push("把昨日营收拆成总钟数和钟效两层复盘，先确认是客流掉档还是单次服务变短。");
  }
  if (alertSet.has("clock-drop")) {
    suggestions.push("针对高峰时段重排技师班次和前台分单顺序，优先保障有点钟能力的技师吃满客流。");
  }
  if (alertSet.has("stored-consume-low")) {
    suggestions.push("近期减少单纯冲储话术，把重点转到到店唤醒、耗卡体验包和高价值会员二次到店。");
  }
  if (alertSet.has("sleeping-members-high")) {
    suggestions.push("立即筛出 90 天未消费会员，按高余额/高历史消费优先级做分层召回。");
  }
  if (alertSet.has("tech-commission-high")) {
    suggestions.push("复核提成设置和折扣策略，避免高提成项目把门店毛利持续压扁。");
  }
  if (alertSet.has("groupbuy-share-high")) {
    suggestions.push(
      "把团购客单独建回访名单，离店前完成留资和平台标记，7 天内重点追复到店、开卡、储值，30 天再看是否转成会员消费。",
    );
  }
  if (metrics.totalClockCount > 0 && metrics.clockEffect > 0) {
    suggestions.push(
      `围绕“时间售卖 + 服务交付”模型，今天继续盯钟效，当前钟效约 ${round(metrics.clockEffect, 1)} 元/钟。`,
    );
  }
  if (metrics.marketRevenue > 0) {
    suggestions.push("把昨日推销成交的项目和话术沉淀给班前会，优先复制到同班次技师。");
  }
  if (metrics.newMembers > 0) {
    suggestions.push("对昨日新增会员做 3 日内回访，目标是把首充会员尽快转成首次耗卡会员。");
  }

  const unique = Array.from(new Set(suggestions));
  if (unique.length < 3) {
    unique.push("把昨日高表现技师的服务流程做成可复制动作，减少单点依赖。");
  }
  if (unique.length < 4) {
    unique.push("日报先看营收、总钟数、储值耗卡比和技师提成占比，这四项最能反映单店盈利质量。");
  }
  return unique.slice(0, 5);
}

export function hasSufficientSyncCoverage(params: {
  bizDate: string;
  timeZone: string;
  cutoffLocalTime: string;
  watermarks: Record<string, string>;
}): boolean {
  return listStaleSyncEndpoints(params).length === 0;
}

export function listStaleSyncEndpoints(params: {
  bizDate: string;
  timeZone: string;
  cutoffLocalTime: string;
  watermarks: Record<string, string>;
}): string[] {
  const completionTime = Date.parse(
    resolveOperationalBizDateCompletionIso({
      bizDate: params.bizDate,
      timeZone: params.timeZone,
      cutoffLocalTime: params.cutoffLocalTime,
    }),
  );
  return REQUIRED_SYNC_ENDPOINTS.filter((endpoint) => {
    const watermark = params.watermarks[endpoint];
    if (!watermark) {
      return true;
    }
    const watermarkTime = Date.parse(watermark);
    return !Number.isFinite(watermarkTime) || watermarkTime < completionTime;
  });
}

function formatStaleSyncAlertMessage(endpoints: string[] | undefined): string {
  if (!endpoints || endpoints.length === 0) {
    return "同步关键接口未更新，正式日报降级。";
  }
  if (endpoints.length === 1 && endpoints[0] === "1.4") {
    return "账户流水 1.4 未更新，正式日报降级。";
  }
  if (endpoints.length === 1) {
    return `接口 ${endpoints[0]} 未更新，正式日报降级。`;
  }
  return `接口 ${endpoints.join("、")} 未更新，正式日报降级。`;
}

export async function computeDailyStoreMetrics(params: {
  config: HetangOpsConfig;
  store: HetangOpsStore;
  orgId: string;
  bizDate: string;
}): Promise<{
  metrics: DailyStoreMetrics;
  alerts: DailyStoreAlert[];
  suggestions: string[];
}> {
  const storeConfig = getStoreByOrgId(params.config, params.orgId);
  const earliestBizDate = "1900-01-01";
  const [
    consume,
    consumeLookback,
    recharge,
    rechargeLookback,
    rechargeHistory,
    trades,
    userTradeHistory,
    techClock,
    techMarket,
    currentMembers,
    memberDailySnapshots,
    currentMemberCards,
    memberCardDailySnapshots,
    currentTech,
    watermarks,
  ] = await Promise.all([
    params.store.listConsumeBillsByDate(params.orgId, params.bizDate),
    params.store.listConsumeBillsByDateRange(
      params.orgId,
      shiftBizDate(params.bizDate, -29),
      params.bizDate,
    ),
    params.store.listRechargeBillsByDate(params.orgId, params.bizDate),
    params.store.listRechargeBillsByDateRange(
      params.orgId,
      shiftBizDate(params.bizDate, -29),
      params.bizDate,
    ),
    params.store.listRechargeBillsByDateRange(params.orgId, earliestBizDate, params.bizDate),
    params.store.listUserTradesByDate(params.orgId, params.bizDate),
    params.store.listUserTradesByDateRange(params.orgId, earliestBizDate, params.bizDate),
    params.store.listTechUpClockByDate(params.orgId, params.bizDate),
    params.store.listTechMarketByDate(params.orgId, params.bizDate),
    params.store.listCurrentMembers(params.orgId),
    params.store.listMemberDailySnapshotsByDateRange(params.orgId, params.bizDate, params.bizDate),
    params.store.listCurrentMemberCards(params.orgId),
    params.store.listMemberCardDailySnapshotsByDateRange(
      params.orgId,
      params.bizDate,
      params.bizDate,
    ),
    params.store.listCurrentTech(params.orgId),
    params.store.getEndpointWatermarksForOrg(params.orgId),
  ]);

  const memberStateAtBizDate: MemberIdentityRecord[] =
    memberDailySnapshots.length > 0 ? memberDailySnapshots : currentMembers;
  const memberCardsAtBizDate: MemberCardIdentityRecord[] =
    memberCardDailySnapshots.length > 0 ? memberCardDailySnapshots : currentMemberCards;

  const serviceRevenue = round(
    consume.filter((row) => !row.antiFlag).reduce((sum, row) => sum + row.payAmount, 0),
  );
  const antiServiceRevenue = round(
    consume.filter((row) => row.antiFlag).reduce((sum, row) => sum + row.payAmount, 0),
  );
  const serviceOrderCount = consume.filter((row) => !row.antiFlag).length;
  const customerCount = serviceOrderCount;
  const averageTicket = round(serviceRevenue / Math.max(serviceOrderCount, 1));
  const rechargeCash = round(
    recharge.filter((row) => !row.antiFlag).reduce((sum, row) => sum + row.realityAmount, 0),
  );
  const rechargeStoredValue = round(
    recharge.filter((row) => !row.antiFlag).reduce((sum, row) => sum + row.totalAmount, 0),
  );
  const rechargeBonusValue = round(
    recharge.filter((row) => !row.antiFlag).reduce((sum, row) => sum + row.donateAmount, 0),
  );
  const memberPaymentAmount = round(
    consume
      .filter((row) => !row.antiFlag)
      .reduce((sum, row) => sum + extractMemberPaymentAmount(row.rawJson), 0),
  );
  const cashPaymentAmount = round(
    consume
      .filter((row) => !row.antiFlag)
      .reduce((sum, row) => sum + extractCashPaymentAmount(row.rawJson), 0),
  );
  const wechatPaymentAmount = round(
    consume
      .filter((row) => !row.antiFlag)
      .reduce((sum, row) => sum + extractWechatPaymentAmount(row.rawJson), 0),
  );
  const alipayPaymentAmount = round(
    consume
      .filter((row) => !row.antiFlag)
      .reduce((sum, row) => sum + extractAlipayPaymentAmount(row.rawJson), 0),
  );
  const storedConsumeAmountFromTrades = round(
    Math.abs(
      trades
        .filter((row) => !row.antiFlag && row.changeBalance < 0)
        .reduce((sum, row) => sum + row.changeBalance, 0),
    ),
  );
  const storedConsumeAmount =
    memberPaymentAmount > 0 ? memberPaymentAmount : storedConsumeAmountFromTrades;
  const memberPaymentShare = percent(storedConsumeAmount, serviceRevenue);
  const cashPaymentShare = percent(cashPaymentAmount, serviceRevenue);
  const wechatPaymentShare = percent(wechatPaymentAmount, serviceRevenue);
  const alipayPaymentShare = percent(alipayPaymentAmount, serviceRevenue);
  const storedConsumeRate = percent(storedConsumeAmount, rechargeCash);
  const groupbuyOrderCount = consume.filter(
    (row) => !row.antiFlag && extractGroupbuyPaymentAmount(row.rawJson) > 0,
  ).length;
  const groupbuyAmount = round(
    consume
      .filter((row) => !row.antiFlag)
      .reduce((sum, row) => sum + extractGroupbuyPaymentAmount(row.rawJson), 0),
  );
  const groupbuyOrderShare = percent(groupbuyOrderCount, serviceOrderCount);
  const groupbuyAmountShare = percent(groupbuyAmount, serviceRevenue);
  const groupbuyPlatformBreakdown = buildGroupbuyPlatformBreakdown({
    consume,
    serviceOrderCount,
    serviceRevenue,
  });
  const groupbuyCohortMetrics = buildGroupbuyCohortMetrics({
    consume: consumeLookback,
    recharge: rechargeLookback,
    currentMembers: memberStateAtBizDate,
    currentMemberCards: memberCardsAtBizDate,
  });
  const totalClockCount = round(techClock.reduce((sum, row) => sum + row.count, 0));
  const upClockRecordCount = techClock.length;
  const pointClockRecordCount = techClock.filter((row) =>
    isPointClockRecord({
      clockType: row.clockType,
      rawJson: row.rawJson,
    }),
  ).length;
  const addClockRecordCount = techClock.filter((row) => isAddClockRecord(row.rawJson)).length;
  const pointClockRate = percent(pointClockRecordCount, upClockRecordCount);
  const addClockRate = percent(addClockRecordCount, upClockRecordCount);
  const clockRevenue = round(techClock.reduce((sum, row) => sum + row.turnover, 0));
  const clockEffect = round(serviceRevenue / Math.max(totalClockCount, 1));
  const activeTechCount = new Set(
    techClock.map((row) => row.personCode).filter((value) => value.length > 0),
  ).size;
  const snapshotOnDutyTechCount = currentTech.filter((row) =>
    isOnDutyTechRecord({
      isJob: row.isJob,
      isWork: row.isWork,
      rawJson: row.rawJson,
    }),
  ).length;
  const onDutyTechCount = Math.max(snapshotOnDutyTechCount, activeTechCount);
  const techCommission = round(techClock.reduce((sum, row) => sum + row.comm, 0));
  const techCommissionRate = round(
    percent(techCommission, clockRevenue > 0 ? clockRevenue : serviceRevenue) ?? 0,
    4,
  );
  const marketRevenue = round(techMarket.reduce((sum, row) => sum + row.afterDisc, 0));
  const marketCommission = round(techMarket.reduce((sum, row) => sum + row.commission, 0));
  const effectiveMembers = memberStateAtBizDate.filter((row) => row.silentDays < 180).length;
  const newMembers = memberStateAtBizDate.filter(
    (row) =>
      row.createdTime &&
      resolveOperationalBizDateFromTimestamp(
        row.createdTime,
        params.config.timeZone,
        params.config.sync.businessDayCutoffLocalTime,
      ) === params.bizDate,
  ).length;
  const sleepingMembers = memberStateAtBizDate.filter((row) => row.silentDays >= 90).length;
  const sleepingMemberRate = percent(sleepingMembers, Math.max(effectiveMembers, 1));
  const currentStoredBalance = round(
    memberStateAtBizDate.reduce((sum, row) => sum + row.storedAmount, 0),
  );
  const memberFollowupMetrics = computeMemberFollowupMetrics({
    members: memberStateAtBizDate,
    memberCards: memberCardsAtBizDate,
    rechargeHistory,
    userTradeHistory,
  });

  const roomMetrics = computeRoomMetrics({
    serviceOrderCount,
    totalClockCount,
    roomCount: storeConfig.roomCount,
    operatingHoursPerDay: storeConfig.operatingHoursPerDay,
  });
  const costMetrics = computeCostMetrics({
    serviceRevenue,
    techCommission,
    storeVariableCostRate:
      storeConfig.variableCostRate ?? params.config.analysis.defaultVariableCostRate,
    storeMaterialCostRate:
      storeConfig.materialCostRate ?? params.config.analysis.defaultMaterialCostRate,
    storeFixedMonthlyCost:
      storeConfig.fixedMonthlyCost ?? params.config.analysis.defaultFixedMonthlyCost,
  });

  const incompleteSync = !hasSufficientSyncCoverage({
    bizDate: params.bizDate,
    timeZone: params.config.timeZone,
    cutoffLocalTime: params.config.sync.businessDayCutoffLocalTime,
    watermarks,
  });
  const staleSyncEndpoints = listStaleSyncEndpoints({
    bizDate: params.bizDate,
    timeZone: params.config.timeZone,
    cutoffLocalTime: params.config.sync.businessDayCutoffLocalTime,
    watermarks,
  });
  const unavailableMetrics = [
    ...roomMetrics.unavailable,
    ...costMetrics.unavailable,
    "CAC/活动ROI",
  ];

  const metrics: DailyStoreMetrics = {
    orgId: params.orgId,
    storeName: storeConfig.storeName,
    bizDate: params.bizDate,
    serviceRevenue,
    rechargeCash,
    rechargeStoredValue,
    rechargeBonusValue,
    antiServiceRevenue,
    serviceOrderCount,
    customerCount,
    averageTicket,
    totalClockCount,
    upClockRecordCount,
    pointClockRecordCount,
    pointClockRate,
    addClockRecordCount,
    addClockRate,
    clockRevenue,
    clockEffect,
    activeTechCount,
    onDutyTechCount,
    techCommission,
    techCommissionRate,
    marketRevenue,
    marketCommission,
    memberPaymentAmount: storedConsumeAmount,
    memberPaymentShare,
    cashPaymentAmount,
    cashPaymentShare,
    wechatPaymentAmount,
    wechatPaymentShare,
    alipayPaymentAmount,
    alipayPaymentShare,
    storedConsumeAmount,
    storedConsumeRate,
    groupbuyOrderCount,
    groupbuyOrderShare,
    groupbuyAmount,
    groupbuyAmountShare,
    groupbuyPlatformBreakdown,
    groupbuyCohortCustomerCount: groupbuyCohortMetrics.groupbuyCohortCustomerCount,
    groupbuyRevisitCustomerCount: groupbuyCohortMetrics.groupbuyRevisitCustomerCount,
    groupbuyRevisitRate: groupbuyCohortMetrics.groupbuyRevisitRate,
    groupbuyMemberPayConvertedCustomerCount:
      groupbuyCohortMetrics.groupbuyMemberPayConvertedCustomerCount,
    groupbuyMemberPayConversionRate: groupbuyCohortMetrics.groupbuyMemberPayConversionRate,
    groupbuy7dRevisitCustomerCount: groupbuyCohortMetrics.groupbuy7dRevisitCustomerCount,
    groupbuy7dRevisitRate: groupbuyCohortMetrics.groupbuy7dRevisitRate,
    groupbuy7dCardOpenedCustomerCount: groupbuyCohortMetrics.groupbuy7dCardOpenedCustomerCount,
    groupbuy7dCardOpenedRate: groupbuyCohortMetrics.groupbuy7dCardOpenedRate,
    groupbuy7dStoredValueConvertedCustomerCount:
      groupbuyCohortMetrics.groupbuy7dStoredValueConvertedCustomerCount,
    groupbuy7dStoredValueConversionRate: groupbuyCohortMetrics.groupbuy7dStoredValueConversionRate,
    groupbuy30dMemberPayConvertedCustomerCount:
      groupbuyCohortMetrics.groupbuy30dMemberPayConvertedCustomerCount,
    groupbuy30dMemberPayConversionRate: groupbuyCohortMetrics.groupbuy30dMemberPayConversionRate,
    groupbuyFirstOrderCustomerCount: groupbuyCohortMetrics.groupbuyFirstOrderCustomerCount,
    groupbuyFirstOrderHighValueMemberCustomerCount:
      groupbuyCohortMetrics.groupbuyFirstOrderHighValueMemberCustomerCount,
    groupbuyFirstOrderHighValueMemberRate:
      groupbuyCohortMetrics.groupbuyFirstOrderHighValueMemberRate,
    effectiveMembers,
    newMembers,
    sleepingMembers,
    sleepingMemberRate,
    currentStoredBalance,
    highBalanceSleepingMemberCount: memberFollowupMetrics.highBalanceSleepingMemberCount,
    highBalanceSleepingMemberAmount: memberFollowupMetrics.highBalanceSleepingMemberAmount,
    firstChargeUnconsumedMemberCount: memberFollowupMetrics.firstChargeUnconsumedMemberCount,
    firstChargeUnconsumedMemberAmount: memberFollowupMetrics.firstChargeUnconsumedMemberAmount,
    roomOccupancyRate: roomMetrics.roomOccupancyRate,
    roomTurnoverRate: roomMetrics.roomTurnoverRate,
    grossMarginRate: costMetrics.grossMarginRate,
    netMarginRate: costMetrics.netMarginRate,
    breakEvenRevenue: costMetrics.breakEvenRevenue,
    incompleteSync,
    staleSyncEndpoints,
    unavailableMetrics,
  };

  const previousBizDate = shiftBizDate(params.bizDate, -1);
  const previousMetrics = await params.store.getDailyMetrics(params.orgId, previousBizDate);
  const alerts = buildAlerts({
    config: params.config,
    metrics,
    previousMetrics,
  });
  const suggestions = buildSuggestions(metrics, alerts);

  return { metrics, alerts, suggestions };
}

export function formatMetricLine(label: string, value: string): string {
  return `- ${label}: ${value}`;
}

export function formatPercentValue(value: number | null): string {
  return formatPercent(value);
}
