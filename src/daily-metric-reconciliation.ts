import { getStoreByOrgId } from "./config.js";
import {
  extractConsumeCustomerIdentityKeys,
  extractConsumeCustomerRefs,
} from "./customer-intelligence.js";
import {
  buildGroupbuyCohortMetrics,
  computeDailyStoreMetrics,
  listStaleSyncEndpoints,
} from "./metrics.js";
import { resolveDailyMetricWindowSignals } from "./report-window-signals.js";
import { resolveOperationalBizDateFromTimestamp, shiftBizDate } from "./time.js";
import type {
  ConsumeBillRecord,
  DailyGroupbuyPlatformMetric,
  DailyStoreMetrics,
  HetangOpsConfig,
  MemberCardCurrentRecord,
  MemberCurrentRecord,
  RechargeBillRecord,
  StoreReview7dRow,
  StoreSummary30dRow,
  TechCurrentRecord,
  TechMarketRecord,
  TechUpClockRecord,
  UserTradeRecord,
} from "./types.js";

const GROUPBUY_PAYMENT_NAMES = new Set(["美团", "抖音", "美团团购", "抖音团购"]);
const GROUPBUY_PLATFORM_ORDER = ["美团", "抖音"] as const;

export type DailyMetricReconciliationCliOptions = {
  orgId: string;
  bizDate: string;
  configPath?: string;
  json: boolean;
  failOnDiff: boolean;
  showMatches: boolean;
};

export type DailyMetricAuditStatus =
  | "match"
  | "fresh_mismatch"
  | "stored_mismatch"
  | "fresh_and_stored_mismatch"
  | "missing_stored";

export type DailyMetricAuditItem = {
  metricKey: string;
  label: string;
  category: string;
  expected: unknown;
  fresh: unknown;
  stored: unknown;
  source: string;
  status: DailyMetricAuditStatus;
  note?: string;
};

export type DailyMetricReconciliationSummary = {
  auditedMetricCount: number;
  matchCount: number;
  freshMismatchCount: number;
  storedMismatchCount: number;
  missingStoredCount: number;
  hasDiffs: boolean;
  unauditedMetricKeys: string[];
};

export type DailyMetricReconciliationReport = {
  orgId: string;
  storeName: string;
  bizDate: string;
  summary: DailyMetricReconciliationSummary;
  items: DailyMetricAuditItem[];
};

type QueryStoreLike = {
  listConsumeBillsByDate: (orgId: string, bizDate: string) => Promise<ConsumeBillRecord[]>;
  listConsumeBillsByDateRange: (
    orgId: string,
    startBizDate: string,
    endBizDate: string,
  ) => Promise<ConsumeBillRecord[]>;
  listRechargeBillsByDate: (orgId: string, bizDate: string) => Promise<RechargeBillRecord[]>;
  listRechargeBillsByDateRange: (
    orgId: string,
    startBizDate: string,
    endBizDate: string,
  ) => Promise<RechargeBillRecord[]>;
  listUserTradesByDate: (orgId: string, bizDate: string) => Promise<UserTradeRecord[]>;
  listUserTradesByDateRange: (
    orgId: string,
    startBizDate: string,
    endBizDate: string,
  ) => Promise<UserTradeRecord[]>;
  listTechUpClockByDate: (orgId: string, bizDate: string) => Promise<TechUpClockRecord[]>;
  listTechMarketByDate: (orgId: string, bizDate: string) => Promise<TechMarketRecord[]>;
  listCurrentMembers: (orgId: string) => Promise<MemberCurrentRecord[]>;
  listMemberDailySnapshotsByDateRange: (
    orgId: string,
    startBizDate: string,
    endBizDate: string,
  ) => Promise<MemberCurrentRecord[]>;
  listCurrentMemberCards: (orgId: string) => Promise<MemberCardCurrentRecord[]>;
  listMemberCardDailySnapshotsByDateRange: (
    orgId: string,
    startBizDate: string,
    endBizDate: string,
  ) => Promise<MemberCardCurrentRecord[]>;
  listCurrentTech: (orgId: string) => Promise<TechCurrentRecord[]>;
  listStoreReview7dByDateRange?: (
    orgId: string,
    startBizDate: string,
    endBizDate: string,
  ) => Promise<StoreReview7dRow[]>;
  listStoreSummary30dByDateRange?: (
    orgId: string,
    startBizDate: string,
    endBizDate: string,
  ) => Promise<StoreSummary30dRow[]>;
  getEndpointWatermarksForOrg: (orgId: string) => Promise<Record<string, string>>;
  getDailyMetrics: (orgId: string, bizDate: string) => Promise<DailyStoreMetrics | null>;
};

type ParsedPayment = {
  name: string;
  amount: number;
  paymentType: number | null;
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

type MemberIdentityIndexes = {
  memberById: Map<string, MemberIdentityRecord>;
  memberIdByPhone: Map<string, string>;
  memberIdByCardNo: Map<string, string>;
  memberIdByCardId: Map<string, string>;
  memberIdsByName: Map<string, string[]>;
};

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

function hasExplicitConsumeCustomerSignal(rawJson: string): boolean {
  if (extractConsumeCustomerRefs(rawJson).length > 0) {
    return true;
  }
  const parsed = parseRawRecord(rawJson);
  return (
    String(
      parsed.MemberPhone ??
        parsed.Phone ??
        parsed.CardNo ??
        parsed.CardId ??
        parsed.MemberName ??
        parsed.Name ??
        "",
    ).trim().length > 0
  );
}

function isCountableServiceConsumeBill(row: ConsumeBillRecord): boolean {
  if (row.antiFlag) {
    return false;
  }
  if (row.payAmount > 0 || row.consumeAmount > 0 || row.discountAmount > 0) {
    return true;
  }
  if (extractPayments(row.rawJson).some((payment) => payment.amount > 0)) {
    return true;
  }
  return hasExplicitConsumeCustomerSignal(row.rawJson);
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

function resolveConsumeBillCustomerCount(
  consumeBill: ConsumeBillRecord,
  indexes: MemberIdentityIndexes,
): number {
  const canonicalCustomerKeys = extractCanonicalConsumeCustomerKeys(consumeBill.rawJson, indexes);
  if (canonicalCustomerKeys.length > 0) {
    return canonicalCustomerKeys.length;
  }
  const fallbackIdentityKeys = extractConsumeCustomerIdentityKeys(consumeBill.rawJson);
  if (fallbackIdentityKeys.length > 0) {
    return fallbackIdentityKeys.length;
  }
  return 1;
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
}) {
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

function buildExpectedDailyMetrics(params: {
  config: HetangOpsConfig;
  orgId: string;
  bizDate: string;
  consume: ConsumeBillRecord[];
  consumeLookback: ConsumeBillRecord[];
  recharge: RechargeBillRecord[];
  rechargeLookback: RechargeBillRecord[];
  rechargeHistory: RechargeBillRecord[];
  trades: UserTradeRecord[];
  userTradeHistory: UserTradeRecord[];
  techClock: TechUpClockRecord[];
  techMarket: TechMarketRecord[];
  memberStateAtBizDate: MemberIdentityRecord[];
  memberCardsAtBizDate: MemberCardIdentityRecord[];
  currentTech: TechCurrentRecord[];
  watermarks: Record<string, string>;
}): DailyStoreMetrics {
  const storeConfig = getStoreByOrgId(params.config, params.orgId);
  const memberIndexes = buildMemberIdentityIndexes({
    currentMembers: params.memberStateAtBizDate,
    currentMemberCards: params.memberCardsAtBizDate,
  });

  const serviceRevenue = round(
    params.consume.filter((row) => !row.antiFlag).reduce((sum, row) => sum + row.payAmount, 0),
  );
  const antiServiceRevenue = round(
    params.consume.filter((row) => row.antiFlag).reduce((sum, row) => sum + row.payAmount, 0),
  );
  const serviceConsume = params.consume.filter(isCountableServiceConsumeBill);
  const serviceOrderCount = serviceConsume.length;
  const customerCount = serviceConsume.reduce(
    (sum, row) => sum + resolveConsumeBillCustomerCount(row, memberIndexes),
    0,
  );
  const averageTicket = round(serviceRevenue / Math.max(customerCount, 1));
  const rechargeCash = round(
    params.recharge
      .filter((row) => !row.antiFlag)
      .reduce((sum, row) => sum + row.realityAmount, 0),
  );
  const rechargeStoredValue = round(
    params.recharge.filter((row) => !row.antiFlag).reduce((sum, row) => sum + row.totalAmount, 0),
  );
  const rechargeBonusValue = round(
    params.recharge
      .filter((row) => !row.antiFlag)
      .reduce((sum, row) => sum + row.donateAmount, 0),
  );
  const memberPaymentAmountFromPayments = round(
    params.consume
      .filter((row) => !row.antiFlag)
      .reduce((sum, row) => sum + extractPaymentAmount(row.rawJson, isMemberPayment), 0),
  );
  const cashPaymentAmount = round(
    params.consume
      .filter((row) => !row.antiFlag)
      .reduce((sum, row) => sum + extractPaymentAmount(row.rawJson, isCashPayment), 0),
  );
  const wechatPaymentAmount = round(
    params.consume
      .filter((row) => !row.antiFlag)
      .reduce((sum, row) => sum + extractPaymentAmount(row.rawJson, isWechatPayment), 0),
  );
  const alipayPaymentAmount = round(
    params.consume
      .filter((row) => !row.antiFlag)
      .reduce((sum, row) => sum + extractPaymentAmount(row.rawJson, isAlipayPayment), 0),
  );
  const storedConsumeAmountFromTrades = round(
    Math.abs(
      params.trades
        .filter((row) => !row.antiFlag && row.changeBalance < 0)
        .reduce((sum, row) => sum + row.changeBalance, 0),
    ),
  );
  const storedConsumeAmount =
    memberPaymentAmountFromPayments > 0
      ? memberPaymentAmountFromPayments
      : storedConsumeAmountFromTrades;
  const memberPaymentShare = percent(storedConsumeAmount, serviceRevenue);
  const cashPaymentShare = percent(cashPaymentAmount, serviceRevenue);
  const wechatPaymentShare = percent(wechatPaymentAmount, serviceRevenue);
  const alipayPaymentShare = percent(alipayPaymentAmount, serviceRevenue);
  const storedConsumeRate = percent(storedConsumeAmount, rechargeCash);
  const groupbuyOrderCount = params.consume.filter(
    (row) => !row.antiFlag && extractPaymentAmount(row.rawJson, isGroupbuyPayment) > 0,
  ).length;
  const groupbuyAmount = round(
    params.consume
      .filter((row) => !row.antiFlag)
      .reduce((sum, row) => sum + extractPaymentAmount(row.rawJson, isGroupbuyPayment), 0),
  );
  const groupbuyOrderShare = percent(groupbuyOrderCount, serviceOrderCount);
  const groupbuyAmountShare = percent(groupbuyAmount, serviceRevenue);
  const groupbuyPlatformBreakdown = buildGroupbuyPlatformBreakdown({
    consume: params.consume,
    serviceOrderCount,
    serviceRevenue,
  });
  const groupbuyCohortMetrics = buildGroupbuyCohortMetrics({
    consume: params.consumeLookback,
    recharge: params.rechargeLookback,
    currentMembers: params.memberStateAtBizDate,
    currentMemberCards: params.memberCardsAtBizDate,
  });
  const totalClockCount = round(params.techClock.reduce((sum, row) => sum + row.count, 0));
  const upClockRecordCount = params.techClock.length;
  const pointClockRecordCount = params.techClock.filter((row) =>
    isPointClockRecord({
      clockType: row.clockType,
      rawJson: row.rawJson,
    }),
  ).length;
  const addClockRecordCount = params.techClock.filter((row) => isAddClockRecord(row.rawJson)).length;
  const pointClockRate = percent(pointClockRecordCount, upClockRecordCount);
  const addClockRate = percent(addClockRecordCount, upClockRecordCount);
  const clockRevenue = round(params.techClock.reduce((sum, row) => sum + row.turnover, 0));
  const clockEffect = round(serviceRevenue / Math.max(totalClockCount, 1));
  const activeTechCount = new Set(
    params.techClock.map((row) => row.personCode).filter((value) => value.length > 0),
  ).size;
  const snapshotOnDutyTechCount = params.currentTech.filter((row) =>
    isOnDutyTechRecord({
      isJob: row.isJob,
      isWork: row.isWork,
      rawJson: row.rawJson,
    }),
  ).length;
  const onDutyTechCount = Math.max(snapshotOnDutyTechCount, activeTechCount);
  const techCommission = round(params.techClock.reduce((sum, row) => sum + row.comm, 0));
  const techCommissionRate = round(
    percent(techCommission, clockRevenue > 0 ? clockRevenue : serviceRevenue) ?? 0,
    4,
  );
  const marketRevenue = round(params.techMarket.reduce((sum, row) => sum + row.afterDisc, 0));
  const marketCommission = round(params.techMarket.reduce((sum, row) => sum + row.commission, 0));
  const effectiveMembers = params.memberStateAtBizDate.filter((row) => row.silentDays < 180).length;
  const newMembers = params.memberStateAtBizDate.filter(
    (row) =>
      row.createdTime &&
      resolveOperationalBizDateFromTimestamp(
        row.createdTime,
        params.config.timeZone,
        params.config.sync.businessDayCutoffLocalTime,
      ) === params.bizDate,
  ).length;
  const sleepingMembers = params.memberStateAtBizDate.filter((row) => row.silentDays >= 90).length;
  const sleepingMemberRate = percent(sleepingMembers, Math.max(effectiveMembers, 1));
  const currentStoredBalance = round(
    params.memberStateAtBizDate.reduce((sum, row) => sum + row.storedAmount, 0),
  );
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
  const staleSyncEndpoints = listStaleSyncEndpoints({
    bizDate: params.bizDate,
    timeZone: params.config.timeZone,
    cutoffLocalTime: params.config.sync.businessDayCutoffLocalTime,
    watermarks: params.watermarks,
  });
  const incompleteSync = staleSyncEndpoints.length > 0;
  const unavailableMetrics = [
    ...roomMetrics.unavailable,
    ...costMetrics.unavailable,
    "CAC/活动ROI",
  ];
  const followupMetrics = computeMemberFollowupMetrics({
    members: params.memberStateAtBizDate,
    memberCards: params.memberCardsAtBizDate,
    rechargeHistory: params.rechargeHistory,
    userTradeHistory: params.userTradeHistory,
  });

  return {
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
    groupbuy7dStoredValueConversionRate:
      groupbuyCohortMetrics.groupbuy7dStoredValueConversionRate,
    groupbuy30dMemberPayConvertedCustomerCount:
      groupbuyCohortMetrics.groupbuy30dMemberPayConvertedCustomerCount,
    groupbuy30dMemberPayConversionRate:
      groupbuyCohortMetrics.groupbuy30dMemberPayConversionRate,
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
    highBalanceSleepingMemberCount: followupMetrics.highBalanceSleepingMemberCount,
    highBalanceSleepingMemberAmount: followupMetrics.highBalanceSleepingMemberAmount,
    firstChargeUnconsumedMemberCount: followupMetrics.firstChargeUnconsumedMemberCount,
    firstChargeUnconsumedMemberAmount: followupMetrics.firstChargeUnconsumedMemberAmount,
    roomOccupancyRate: roomMetrics.roomOccupancyRate,
    roomTurnoverRate: roomMetrics.roomTurnoverRate,
    grossMarginRate: costMetrics.grossMarginRate,
    netMarginRate: costMetrics.netMarginRate,
    breakEvenRevenue: costMetrics.breakEvenRevenue,
    incompleteSync,
    staleSyncEndpoints,
    unavailableMetrics,
  };
}

function normalizeComparable(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeComparable(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, current]) => [key, normalizeComparable(current)]),
    );
  }
  return value;
}

function valuesEqual(expected: unknown, actual: unknown, tolerance = 1e-6): boolean {
  if (expected === actual) {
    return true;
  }
  if (expected === null && actual === undefined) {
    return true;
  }
  if (expected === undefined && actual === null) {
    return true;
  }
  if (typeof expected === "number" && typeof actual === "number") {
    return Math.abs(expected - actual) <= tolerance;
  }
  return (
    JSON.stringify(normalizeComparable(expected)) ===
    JSON.stringify(normalizeComparable(actual))
  );
}

function buildAuditItem(params: {
  metricKey: string;
  label: string;
  category: string;
  expected: unknown;
  fresh: unknown;
  stored: unknown;
  source: string;
  note?: string;
}): DailyMetricAuditItem {
  const freshMatches = valuesEqual(params.expected, params.fresh);
  const hasStored = params.stored !== undefined;
  const storedMatches = hasStored ? valuesEqual(params.expected, params.stored) : false;

  let status: DailyMetricAuditStatus = "match";
  if (!hasStored) {
    status = freshMatches ? "missing_stored" : "fresh_mismatch";
  } else if (!freshMatches && !storedMatches) {
    status = "fresh_and_stored_mismatch";
  } else if (!freshMatches) {
    status = "fresh_mismatch";
  } else if (!storedMatches) {
    status = "stored_mismatch";
  }

  return {
    metricKey: params.metricKey,
    label: params.label,
    category: params.category,
    expected: params.expected,
    fresh: params.fresh,
    stored: params.stored,
    source: params.source,
    status,
    note: params.note,
  };
}

async function loadDailyMetricWindowSignals(params: {
  store: QueryStoreLike;
  orgId: string;
  bizDate: string;
}): Promise<{
  review?: StoreReview7dRow | null;
  summary?: StoreSummary30dRow | null;
}> {
  try {
    const [reviewRows, summaryRows] = await Promise.all([
      params.store.listStoreReview7dByDateRange
        ? params.store.listStoreReview7dByDateRange(params.orgId, params.bizDate, params.bizDate)
        : Promise.resolve([]),
      params.store.listStoreSummary30dByDateRange
        ? params.store.listStoreSummary30dByDateRange(params.orgId, params.bizDate, params.bizDate)
        : Promise.resolve([]),
    ]);

    return {
      review: reviewRows[0],
      summary: summaryRows[0],
    };
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
    if (code === "42P01") {
      return {};
    }
    throw error;
  }
}

function stringifyValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null || value === undefined) {
    return "null";
  }
  return JSON.stringify(normalizeComparable(value));
}

export function renderDailyMetricReconciliationUsage(): string {
  return [
    "Usage:",
    "  node --import tsx scripts/reconcile-daily-metrics.ts --org ORG_ID --date YYYY-MM-DD [--config /path/to/htops.json] [--json] [--fail-on-diff] [--show-matches]",
  ].join("\n");
}

export function parseDailyMetricReconciliationArgs(
  argv: string[],
): DailyMetricReconciliationCliOptions {
  let orgId: string | undefined;
  let bizDate: string | undefined;
  let configPath: string | undefined;
  let json = false;
  let failOnDiff = false;
  let showMatches = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--org") {
      orgId = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--date") {
      bizDate = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--config") {
      configPath = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--json") {
      json = true;
      continue;
    }
    if (token === "--fail-on-diff") {
      failOnDiff = true;
      continue;
    }
    if (token === "--show-matches") {
      showMatches = true;
      continue;
    }
    if (token === "--help" || token === "-h") {
      throw new Error(renderDailyMetricReconciliationUsage());
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  if (!orgId) {
    throw new Error("--org is required");
  }
  if (!bizDate) {
    throw new Error("--date is required");
  }

  return {
    orgId,
    bizDate,
    configPath,
    json,
    failOnDiff,
    showMatches,
  };
}

export async function reconcileDailyStoreMetrics(params: {
  config: HetangOpsConfig;
  store: QueryStoreLike;
  orgId: string;
  bizDate: string;
}): Promise<DailyMetricReconciliationReport> {
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
    storedMetrics,
    freshResult,
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
    params.store.listRechargeBillsByDateRange(params.orgId, "1900-01-01", params.bizDate),
    params.store.listUserTradesByDate(params.orgId, params.bizDate),
    params.store.listUserTradesByDateRange(params.orgId, "1900-01-01", params.bizDate),
    params.store.listTechUpClockByDate(params.orgId, params.bizDate),
    params.store.listTechMarketByDate(params.orgId, params.bizDate),
    params.store.listCurrentMembers(params.orgId),
    params.store.listMemberDailySnapshotsByDateRange(params.orgId, params.bizDate, params.bizDate),
    params.store.listCurrentMemberCards(params.orgId),
    params.store.listMemberCardDailySnapshotsByDateRange(params.orgId, params.bizDate, params.bizDate),
    params.store.listCurrentTech(params.orgId),
    params.store.getEndpointWatermarksForOrg(params.orgId),
    params.store.getDailyMetrics(params.orgId, params.bizDate),
    computeDailyStoreMetrics({
      config: params.config,
      store: params.store as never,
      orgId: params.orgId,
      bizDate: params.bizDate,
    }),
  ]);
  const windowSignals = await loadDailyMetricWindowSignals({
    store: params.store,
    orgId: params.orgId,
    bizDate: params.bizDate,
  });

  const memberStateAtBizDate =
    memberDailySnapshots.length > 0 ? memberDailySnapshots : currentMembers;
  const memberCardsAtBizDate =
    memberCardDailySnapshots.length > 0 ? memberCardDailySnapshots : currentMemberCards;
  const expectedBase = buildExpectedDailyMetrics({
    config: params.config,
    orgId: params.orgId,
    bizDate: params.bizDate,
    consume,
    consumeLookback,
    recharge,
    rechargeLookback,
    rechargeHistory,
    trades,
    userTradeHistory,
    techClock,
    techMarket,
    memberStateAtBizDate,
    memberCardsAtBizDate,
    currentTech,
    watermarks,
  });
  const expected = resolveDailyMetricWindowSignals({
    metrics: expectedBase,
    review: windowSignals.review,
    summary: windowSignals.summary,
  });
  const fresh = resolveDailyMetricWindowSignals({
    metrics: freshResult.metrics,
    review: windowSignals.review,
    summary: windowSignals.summary,
  });

  const items: DailyMetricAuditItem[] = [
    buildAuditItem({
      metricKey: "serviceRevenue",
      label: "服务营收",
      category: "revenue",
      expected: expected.serviceRevenue,
      fresh: fresh.serviceRevenue,
      stored: storedMetrics?.serviceRevenue,
      source: "sum(consume.payAmount where antiFlag=false)",
    }),
    buildAuditItem({
      metricKey: "antiServiceRevenue",
      label: "反结/冲减金额",
      category: "revenue",
      expected: expected.antiServiceRevenue,
      fresh: fresh.antiServiceRevenue,
      stored: storedMetrics?.antiServiceRevenue,
      source: "sum(consume.payAmount where antiFlag=true)",
    }),
    buildAuditItem({
      metricKey: "serviceOrderCount",
      label: "服务单数",
      category: "revenue",
      expected: expected.serviceOrderCount,
      fresh: fresh.serviceOrderCount,
      stored: storedMetrics?.serviceOrderCount,
      source: "count(countable service consume bills)",
    }),
    buildAuditItem({
      metricKey: "customerCount",
      label: "到店人数",
      category: "revenue",
      expected: expected.customerCount,
      fresh: fresh.customerCount,
      stored: storedMetrics?.customerCount,
      source: "sum(resolveConsumeBillCustomerCount per countable service consume bill)",
      note: "口径为结算级真实到店人次：排除纯 0 元自动结算，保留全免券/优惠券服务到店。",
    }),
    buildAuditItem({
      metricKey: "averageTicket",
      label: "客单价",
      category: "revenue",
      expected: expected.averageTicket,
      fresh: fresh.averageTicket,
      stored: storedMetrics?.averageTicket,
      source: "serviceRevenue / customerCount",
    }),
    buildAuditItem({
      metricKey: "rechargeCash",
      label: "充值现金",
      category: "recharge",
      expected: expected.rechargeCash,
      fresh: fresh.rechargeCash,
      stored: storedMetrics?.rechargeCash,
      source: "sum(recharge.realityAmount where antiFlag=false)",
    }),
    buildAuditItem({
      metricKey: "rechargeStoredValue",
      label: "充值总额(含赠送)",
      category: "recharge",
      expected: expected.rechargeStoredValue,
      fresh: fresh.rechargeStoredValue,
      stored: storedMetrics?.rechargeStoredValue,
      source: "sum(recharge.totalAmount where antiFlag=false)",
    }),
    buildAuditItem({
      metricKey: "rechargeBonusValue",
      label: "充值赠送金额",
      category: "recharge",
      expected: expected.rechargeBonusValue,
      fresh: fresh.rechargeBonusValue,
      stored: storedMetrics?.rechargeBonusValue,
      source: "sum(recharge.donateAmount where antiFlag=false)",
    }),
    buildAuditItem({
      metricKey: "memberPaymentAmount",
      label: "会员支付金额",
      category: "payments",
      expected: expected.memberPaymentAmount,
      fresh: fresh.memberPaymentAmount,
      stored: storedMetrics?.memberPaymentAmount,
      source: "sum(member payments) else abs(sum(userTrade.changeBalance<0))",
    }),
    buildAuditItem({
      metricKey: "memberPaymentShare",
      label: "会员消费占比",
      category: "payments",
      expected: expected.memberPaymentShare,
      fresh: fresh.memberPaymentShare,
      stored: storedMetrics?.memberPaymentShare,
      source: "memberPaymentAmount / serviceRevenue",
    }),
    buildAuditItem({
      metricKey: "cashPaymentAmount",
      label: "现金支付金额",
      category: "payments",
      expected: expected.cashPaymentAmount,
      fresh: fresh.cashPaymentAmount,
      stored: storedMetrics?.cashPaymentAmount,
      source: "sum(cash payments)",
    }),
    buildAuditItem({
      metricKey: "cashPaymentShare",
      label: "现金支付占比",
      category: "payments",
      expected: expected.cashPaymentShare,
      fresh: fresh.cashPaymentShare,
      stored: storedMetrics?.cashPaymentShare,
      source: "cashPaymentAmount / serviceRevenue",
    }),
    buildAuditItem({
      metricKey: "wechatPaymentAmount",
      label: "微信支付金额",
      category: "payments",
      expected: expected.wechatPaymentAmount,
      fresh: fresh.wechatPaymentAmount,
      stored: storedMetrics?.wechatPaymentAmount,
      source: "sum(wechat payments)",
    }),
    buildAuditItem({
      metricKey: "wechatPaymentShare",
      label: "微信支付占比",
      category: "payments",
      expected: expected.wechatPaymentShare,
      fresh: fresh.wechatPaymentShare,
      stored: storedMetrics?.wechatPaymentShare,
      source: "wechatPaymentAmount / serviceRevenue",
    }),
    buildAuditItem({
      metricKey: "alipayPaymentAmount",
      label: "支付宝支付金额",
      category: "payments",
      expected: expected.alipayPaymentAmount,
      fresh: fresh.alipayPaymentAmount,
      stored: storedMetrics?.alipayPaymentAmount,
      source: "sum(alipay payments)",
    }),
    buildAuditItem({
      metricKey: "alipayPaymentShare",
      label: "支付宝支付占比",
      category: "payments",
      expected: expected.alipayPaymentShare,
      fresh: fresh.alipayPaymentShare,
      stored: storedMetrics?.alipayPaymentShare,
      source: "alipayPaymentAmount / serviceRevenue",
    }),
    buildAuditItem({
      metricKey: "storedConsumeAmount",
      label: "耗卡金额",
      category: "payments",
      expected: expected.storedConsumeAmount,
      fresh: fresh.storedConsumeAmount,
      stored: storedMetrics?.storedConsumeAmount,
      source: "sum(member payments) else abs(sum(userTrade.changeBalance<0))",
    }),
    buildAuditItem({
      metricKey: "storedConsumeRate",
      label: "耗卡/充值比",
      category: "payments",
      expected: expected.storedConsumeRate,
      fresh: fresh.storedConsumeRate,
      stored: storedMetrics?.storedConsumeRate,
      source: "storedConsumeAmount / rechargeCash",
    }),
    buildAuditItem({
      metricKey: "groupbuyOrderCount",
      label: "团购单数",
      category: "groupbuy",
      expected: expected.groupbuyOrderCount,
      fresh: fresh.groupbuyOrderCount,
      stored: storedMetrics?.groupbuyOrderCount,
      source: "count(consume with groupbuy payment)",
    }),
    buildAuditItem({
      metricKey: "groupbuyOrderShare",
      label: "团购订单占比",
      category: "groupbuy",
      expected: expected.groupbuyOrderShare,
      fresh: fresh.groupbuyOrderShare,
      stored: storedMetrics?.groupbuyOrderShare,
      source: "groupbuyOrderCount / serviceOrderCount",
    }),
    buildAuditItem({
      metricKey: "groupbuyAmount",
      label: "团购金额",
      category: "groupbuy",
      expected: expected.groupbuyAmount,
      fresh: fresh.groupbuyAmount,
      stored: storedMetrics?.groupbuyAmount,
      source: "sum(groupbuy payment amounts)",
    }),
    buildAuditItem({
      metricKey: "groupbuyAmountShare",
      label: "团购金额占比",
      category: "groupbuy",
      expected: expected.groupbuyAmountShare,
      fresh: fresh.groupbuyAmountShare,
      stored: storedMetrics?.groupbuyAmountShare,
      source: "groupbuyAmount / serviceRevenue",
    }),
    buildAuditItem({
      metricKey: "groupbuyPlatformBreakdown",
      label: "团购平台拆分",
      category: "groupbuy",
      expected: expected.groupbuyPlatformBreakdown,
      fresh: fresh.groupbuyPlatformBreakdown,
      stored: storedMetrics?.groupbuyPlatformBreakdown,
      source: "group by normalized groupbuy payment platform",
    }),
    buildAuditItem({
      metricKey: "groupbuyCohortCustomerCount",
      label: "团购样本客户数",
      category: "groupbuy",
      expected: expected.groupbuyCohortCustomerCount,
      fresh: fresh.groupbuyCohortCustomerCount,
      stored: storedMetrics?.groupbuyCohortCustomerCount,
      source: "count(distinct first observed groupbuy customers within 30d lookback)",
    }),
    buildAuditItem({
      metricKey: "groupbuyRevisitCustomerCount",
      label: "团购复到店客户数",
      category: "groupbuy",
      expected: expected.groupbuyRevisitCustomerCount,
      fresh: fresh.groupbuyRevisitCustomerCount,
      stored: storedMetrics?.groupbuyRevisitCustomerCount,
      source: "count(groupbuy cohort customers with any later visit)",
    }),
    buildAuditItem({
      metricKey: "groupbuyRevisitRate",
      label: "团购复到店率",
      category: "groupbuy",
      expected: expected.groupbuyRevisitRate,
      fresh: fresh.groupbuyRevisitRate,
      stored: storedMetrics?.groupbuyRevisitRate,
      source: "groupbuyRevisitCustomerCount / groupbuyCohortCustomerCount",
    }),
    buildAuditItem({
      metricKey: "groupbuyMemberPayConvertedCustomerCount",
      label: "团购会员支付转化客户数",
      category: "groupbuy",
      expected: expected.groupbuyMemberPayConvertedCustomerCount,
      fresh: fresh.groupbuyMemberPayConvertedCustomerCount,
      stored: storedMetrics?.groupbuyMemberPayConvertedCustomerCount,
      source: "count(groupbuy cohort customers with any later member-pay visit)",
    }),
    buildAuditItem({
      metricKey: "groupbuyMemberPayConversionRate",
      label: "团购会员支付转化率",
      category: "groupbuy",
      expected: expected.groupbuyMemberPayConversionRate,
      fresh: fresh.groupbuyMemberPayConversionRate,
      stored: storedMetrics?.groupbuyMemberPayConversionRate,
      source: "groupbuyMemberPayConvertedCustomerCount / groupbuyCohortCustomerCount",
    }),
    buildAuditItem({
      metricKey: "groupbuy7dRevisitCustomerCount",
      label: "团购7天复到店客户数",
      category: "groupbuy",
      expected: expected.groupbuy7dRevisitCustomerCount,
      fresh: fresh.groupbuy7dRevisitCustomerCount,
      stored: storedMetrics?.groupbuy7dRevisitCustomerCount,
      source: "count(groupbuy cohort customers with revisit within 7d)",
    }),
    buildAuditItem({
      metricKey: "groupbuy7dRevisitRate",
      label: "团购7天复到店率",
      category: "groupbuy",
      expected: expected.groupbuy7dRevisitRate,
      fresh: fresh.groupbuy7dRevisitRate,
      stored: storedMetrics?.groupbuy7dRevisitRate,
      source: "groupbuy7dRevisitCustomerCount / groupbuyCohortCustomerCount",
    }),
    buildAuditItem({
      metricKey: "groupbuy7dCardOpenedCustomerCount",
      label: "团购7天开卡客户数",
      category: "groupbuy",
      expected: expected.groupbuy7dCardOpenedCustomerCount,
      fresh: fresh.groupbuy7dCardOpenedCustomerCount,
      stored: storedMetrics?.groupbuy7dCardOpenedCustomerCount,
      source: "count(groupbuy cohort customers with member-pay, member-created, or recharge within 7d)",
    }),
    buildAuditItem({
      metricKey: "groupbuy7dCardOpenedRate",
      label: "团购7天开卡率",
      category: "groupbuy",
      expected: expected.groupbuy7dCardOpenedRate,
      fresh: fresh.groupbuy7dCardOpenedRate,
      stored: storedMetrics?.groupbuy7dCardOpenedRate,
      source: "groupbuy7dCardOpenedCustomerCount / groupbuyCohortCustomerCount",
    }),
    buildAuditItem({
      metricKey: "groupbuy7dStoredValueConvertedCustomerCount",
      label: "团购7天储值转化客户数",
      category: "groupbuy",
      expected: expected.groupbuy7dStoredValueConvertedCustomerCount,
      fresh: fresh.groupbuy7dStoredValueConvertedCustomerCount,
      stored: storedMetrics?.groupbuy7dStoredValueConvertedCustomerCount,
      source: "count(groupbuy cohort customers with recharge within 7d)",
    }),
    buildAuditItem({
      metricKey: "groupbuy7dStoredValueConversionRate",
      label: "团购7天储值转化率",
      category: "groupbuy",
      expected: expected.groupbuy7dStoredValueConversionRate,
      fresh: fresh.groupbuy7dStoredValueConversionRate,
      stored: storedMetrics?.groupbuy7dStoredValueConversionRate,
      source: "groupbuy7dStoredValueConvertedCustomerCount / groupbuyCohortCustomerCount",
    }),
    buildAuditItem({
      metricKey: "groupbuy30dMemberPayConvertedCustomerCount",
      label: "团购30天会员消费转化客户数",
      category: "groupbuy",
      expected: expected.groupbuy30dMemberPayConvertedCustomerCount,
      fresh: fresh.groupbuy30dMemberPayConvertedCustomerCount,
      stored: storedMetrics?.groupbuy30dMemberPayConvertedCustomerCount,
      source: "count(groupbuy cohort customers with member-pay within 30d)",
    }),
    buildAuditItem({
      metricKey: "groupbuy30dMemberPayConversionRate",
      label: "团购30天会员消费转化率",
      category: "groupbuy",
      expected: expected.groupbuy30dMemberPayConversionRate,
      fresh: fresh.groupbuy30dMemberPayConversionRate,
      stored: storedMetrics?.groupbuy30dMemberPayConversionRate,
      source: "groupbuy30dMemberPayConvertedCustomerCount / groupbuyCohortCustomerCount",
    }),
    buildAuditItem({
      metricKey: "groupbuyFirstOrderCustomerCount",
      label: "团购首单客户数",
      category: "groupbuy",
      expected: expected.groupbuyFirstOrderCustomerCount,
      fresh: fresh.groupbuyFirstOrderCustomerCount,
      stored: storedMetrics?.groupbuyFirstOrderCustomerCount,
      source: "count(customers whose first observed order is groupbuy)",
    }),
    buildAuditItem({
      metricKey: "groupbuyFirstOrderHighValueMemberCustomerCount",
      label: "团购首单转高价值会员客户数",
      category: "groupbuy",
      expected: expected.groupbuyFirstOrderHighValueMemberCustomerCount,
      fresh: fresh.groupbuyFirstOrderHighValueMemberCustomerCount,
      stored: storedMetrics?.groupbuyFirstOrderHighValueMemberCustomerCount,
      source: "count(first-order groupbuy customers reaching high-value member threshold within 30d)",
    }),
    buildAuditItem({
      metricKey: "groupbuyFirstOrderHighValueMemberRate",
      label: "团购首单转高价值会员率",
      category: "groupbuy",
      expected: expected.groupbuyFirstOrderHighValueMemberRate,
      fresh: fresh.groupbuyFirstOrderHighValueMemberRate,
      stored: storedMetrics?.groupbuyFirstOrderHighValueMemberRate,
      source: "groupbuyFirstOrderHighValueMemberCustomerCount / groupbuyFirstOrderCustomerCount",
    }),
    buildAuditItem({
      metricKey: "totalClockCount",
      label: "总钟数",
      category: "clock",
      expected: expected.totalClockCount,
      fresh: fresh.totalClockCount,
      stored: storedMetrics?.totalClockCount,
      source: "sum(techClock.count)",
    }),
    buildAuditItem({
      metricKey: "upClockRecordCount",
      label: "上钟记录数",
      category: "clock",
      expected: expected.upClockRecordCount,
      fresh: fresh.upClockRecordCount,
      stored: storedMetrics?.upClockRecordCount,
      source: "count(techClock rows)",
    }),
    buildAuditItem({
      metricKey: "pointClockRecordCount",
      label: "点钟记录数",
      category: "clock",
      expected: expected.pointClockRecordCount,
      fresh: fresh.pointClockRecordCount,
      stored: storedMetrics?.pointClockRecordCount,
      source: "count(point clock rows)",
    }),
    buildAuditItem({
      metricKey: "pointClockRate",
      label: "点钟率",
      category: "clock",
      expected: expected.pointClockRate,
      fresh: fresh.pointClockRate,
      stored: storedMetrics?.pointClockRate,
      source: "pointClockRecordCount / upClockRecordCount",
    }),
    buildAuditItem({
      metricKey: "addClockRecordCount",
      label: "加钟记录数",
      category: "clock",
      expected: expected.addClockRecordCount,
      fresh: fresh.addClockRecordCount,
      stored: storedMetrics?.addClockRecordCount,
      source: "count(add clock rows)",
    }),
    buildAuditItem({
      metricKey: "addClockRate",
      label: "加钟率",
      category: "clock",
      expected: expected.addClockRate,
      fresh: fresh.addClockRate,
      stored: storedMetrics?.addClockRate,
      source: "addClockRecordCount / upClockRecordCount",
    }),
    buildAuditItem({
      metricKey: "clockRevenue",
      label: "上钟产值",
      category: "clock",
      expected: expected.clockRevenue,
      fresh: fresh.clockRevenue,
      stored: storedMetrics?.clockRevenue,
      source: "sum(techClock.turnover)",
    }),
    buildAuditItem({
      metricKey: "clockEffect",
      label: "钟效",
      category: "clock",
      expected: expected.clockEffect,
      fresh: fresh.clockEffect,
      stored: storedMetrics?.clockEffect,
      source: "serviceRevenue / totalClockCount",
    }),
    buildAuditItem({
      metricKey: "activeTechCount",
      label: "活跃技师数",
      category: "staffing",
      expected: expected.activeTechCount,
      fresh: fresh.activeTechCount,
      stored: storedMetrics?.activeTechCount,
      source: "count(distinct techClock.personCode)",
    }),
    buildAuditItem({
      metricKey: "onDutyTechCount",
      label: "在岗技师数",
      category: "staffing",
      expected: expected.onDutyTechCount,
      fresh: fresh.onDutyTechCount,
      stored: storedMetrics?.onDutyTechCount,
      source: "max(snapshot on-duty tech count, activeTechCount)",
    }),
    buildAuditItem({
      metricKey: "techCommission",
      label: "技师提成",
      category: "staffing",
      expected: expected.techCommission,
      fresh: fresh.techCommission,
      stored: storedMetrics?.techCommission,
      source: "sum(techClock.comm)",
    }),
    buildAuditItem({
      metricKey: "techCommissionRate",
      label: "技师提成占比",
      category: "staffing",
      expected: expected.techCommissionRate,
      fresh: fresh.techCommissionRate,
      stored: storedMetrics?.techCommissionRate,
      source: "techCommission / (clockRevenue || serviceRevenue)",
    }),
    buildAuditItem({
      metricKey: "marketRevenue",
      label: "推销产值",
      category: "market",
      expected: expected.marketRevenue,
      fresh: fresh.marketRevenue,
      stored: storedMetrics?.marketRevenue,
      source: "sum(techMarket.afterDisc)",
    }),
    buildAuditItem({
      metricKey: "marketCommission",
      label: "推销提成",
      category: "market",
      expected: expected.marketCommission,
      fresh: fresh.marketCommission,
      stored: storedMetrics?.marketCommission,
      source: "sum(techMarket.commission)",
    }),
    buildAuditItem({
      metricKey: "effectiveMembers",
      label: "有效会员",
      category: "members",
      expected: expected.effectiveMembers,
      fresh: fresh.effectiveMembers,
      stored: storedMetrics?.effectiveMembers,
      source: "count(member where silentDays < 180)",
    }),
    buildAuditItem({
      metricKey: "newMembers",
      label: "新增会员",
      category: "members",
      expected: expected.newMembers,
      fresh: fresh.newMembers,
      stored: storedMetrics?.newMembers,
      source: "count(member created within business-day cutoff)",
    }),
    buildAuditItem({
      metricKey: "sleepingMembers",
      label: "沉默会员",
      category: "members",
      expected: expected.sleepingMembers,
      fresh: fresh.sleepingMembers,
      stored: storedMetrics?.sleepingMembers,
      source: "count(member where silentDays >= 90)",
    }),
    buildAuditItem({
      metricKey: "sleepingMemberRate",
      label: "沉默会员占比",
      category: "members",
      expected: expected.sleepingMemberRate,
      fresh: fresh.sleepingMemberRate,
      stored: storedMetrics?.sleepingMemberRate,
      source: "sleepingMembers / effectiveMembers",
    }),
    buildAuditItem({
      metricKey: "currentStoredBalance",
      label: "当前储值余额",
      category: "members",
      expected: expected.currentStoredBalance,
      fresh: fresh.currentStoredBalance,
      stored: storedMetrics?.currentStoredBalance,
      source: "sum(member.storedAmount)",
    }),
    buildAuditItem({
      metricKey: "highBalanceSleepingMemberCount",
      label: "高余额沉默会员数",
      category: "members",
      expected: expected.highBalanceSleepingMemberCount,
      fresh: fresh.highBalanceSleepingMemberCount,
      stored: storedMetrics?.highBalanceSleepingMemberCount,
      source: "count(member silentDays>=90 && storedAmount>=max(1000,p80))",
    }),
    buildAuditItem({
      metricKey: "highBalanceSleepingMemberAmount",
      label: "高余额沉默会员金额",
      category: "members",
      expected: expected.highBalanceSleepingMemberAmount,
      fresh: fresh.highBalanceSleepingMemberAmount,
      stored: storedMetrics?.highBalanceSleepingMemberAmount,
      source: "sum(storedAmount of high-balance sleeping members)",
    }),
    buildAuditItem({
      metricKey: "firstChargeUnconsumedMemberCount",
      label: "首充未耗卡会员数",
      category: "members",
      expected: expected.firstChargeUnconsumedMemberCount,
      fresh: fresh.firstChargeUnconsumedMemberCount,
      stored: storedMetrics?.firstChargeUnconsumedMemberCount,
      source: "count(member with first recharge and no later balance consumption)",
    }),
    buildAuditItem({
      metricKey: "firstChargeUnconsumedMemberAmount",
      label: "首充未耗卡金额",
      category: "members",
      expected: expected.firstChargeUnconsumedMemberAmount,
      fresh: fresh.firstChargeUnconsumedMemberAmount,
      stored: storedMetrics?.firstChargeUnconsumedMemberAmount,
      source: "sum(storedAmount of first-charge-unconsumed members)",
    }),
    buildAuditItem({
      metricKey: "memberRepurchaseBaseCustomerCount7d",
      label: "会员7日复购基数",
      category: "members",
      expected: expected.memberRepurchaseBaseCustomerCount7d,
      fresh: fresh.memberRepurchaseBaseCustomerCount7d,
      stored: storedMetrics?.memberRepurchaseBaseCustomerCount7d,
      source: "review7d/summary30d member repurchase base window",
    }),
    buildAuditItem({
      metricKey: "memberRepurchaseReturnedCustomerCount7d",
      label: "会员7日复购回流客户数",
      category: "members",
      expected: expected.memberRepurchaseReturnedCustomerCount7d,
      fresh: fresh.memberRepurchaseReturnedCustomerCount7d,
      stored: storedMetrics?.memberRepurchaseReturnedCustomerCount7d,
      source: "review7d/summary30d member repurchase returned window",
    }),
    buildAuditItem({
      metricKey: "memberRepurchaseRate7d",
      label: "会员7日复购率",
      category: "members",
      expected: expected.memberRepurchaseRate7d,
      fresh: fresh.memberRepurchaseRate7d,
      stored: storedMetrics?.memberRepurchaseRate7d,
      source: "review7d/summary30d member repurchase rate window",
    }),
    buildAuditItem({
      metricKey: "roomOccupancyRate",
      label: "包间上座率",
      category: "config",
      expected: expected.roomOccupancyRate,
      fresh: fresh.roomOccupancyRate,
      stored: storedMetrics?.roomOccupancyRate,
      source: "totalClockCount / (roomCount * operatingHoursPerDay)",
    }),
    buildAuditItem({
      metricKey: "roomTurnoverRate",
      label: "翻房率",
      category: "config",
      expected: expected.roomTurnoverRate,
      fresh: fresh.roomTurnoverRate,
      stored: storedMetrics?.roomTurnoverRate,
      source: "serviceOrderCount / roomCount",
    }),
    buildAuditItem({
      metricKey: "grossMarginRate",
      label: "毛利率",
      category: "config",
      expected: expected.grossMarginRate,
      fresh: fresh.grossMarginRate,
      stored: storedMetrics?.grossMarginRate,
      source: "(serviceRevenue - techCommission - serviceRevenue*(variable+material)) / serviceRevenue",
    }),
    buildAuditItem({
      metricKey: "netMarginRate",
      label: "净利率",
      category: "config",
      expected: expected.netMarginRate,
      fresh: fresh.netMarginRate,
      stored: storedMetrics?.netMarginRate,
      source: "(serviceRevenue - totalVariableCost - fixedMonthlyCost/30) / serviceRevenue",
    }),
    buildAuditItem({
      metricKey: "breakEvenRevenue",
      label: "保本营收",
      category: "config",
      expected: expected.breakEvenRevenue,
      fresh: fresh.breakEvenRevenue,
      stored: storedMetrics?.breakEvenRevenue,
      source: "fixedMonthlyCost / grossMarginRate",
    }),
    buildAuditItem({
      metricKey: "staleSyncEndpoints",
      label: "滞后接口",
      category: "sync",
      expected: expected.staleSyncEndpoints,
      fresh: fresh.staleSyncEndpoints,
      stored: storedMetrics?.staleSyncEndpoints,
      source: "endpoint watermarks vs business-day completion cutoff",
    }),
    buildAuditItem({
      metricKey: "incompleteSync",
      label: "同步是否不完整",
      category: "sync",
      expected: expected.incompleteSync,
      fresh: fresh.incompleteSync,
      stored: storedMetrics?.incompleteSync,
      source: "staleSyncEndpoints.length > 0",
    }),
    buildAuditItem({
      metricKey: "unavailableMetrics",
      label: "不可用指标",
      category: "sync",
      expected: expected.unavailableMetrics,
      fresh: fresh.unavailableMetrics,
      stored: storedMetrics?.unavailableMetrics,
      source: "missing room/cost config + fixed CAC/活动ROI placeholder",
    }),
  ];

  const auditedKeys = new Set(items.map((item) => item.metricKey));
  const metricKeys = new Set<string>([
    ...Object.keys(fresh),
    ...Object.keys(storedMetrics ?? {}),
  ]);
  const unauditedMetricKeys = Array.from(metricKeys).filter((key) => !auditedKeys.has(key)).sort();
  const matchCount = items.filter((item) => item.status === "match").length;
  const freshMismatchCount = items.filter(
    (item) => item.status === "fresh_mismatch" || item.status === "fresh_and_stored_mismatch",
  ).length;
  const storedMismatchCount = items.filter(
    (item) => item.status === "stored_mismatch" || item.status === "fresh_and_stored_mismatch",
  ).length;
  const missingStoredCount = items.filter((item) => item.status === "missing_stored").length;

  return {
    orgId: params.orgId,
    storeName: expected.storeName,
    bizDate: params.bizDate,
    summary: {
      auditedMetricCount: items.length,
      matchCount,
      freshMismatchCount,
      storedMismatchCount,
      missingStoredCount,
      hasDiffs: freshMismatchCount > 0 || storedMismatchCount > 0 || missingStoredCount > 0,
      unauditedMetricKeys,
    },
    items,
  };
}

export function renderDailyMetricReconciliationReport(
  report: DailyMetricReconciliationReport,
  options: { showMatches?: boolean } = {},
): string {
  const lines = [
    `${report.storeName} ${report.bizDate} 日报指标对账`,
    `summary: audited ${report.summary.auditedMetricCount}, match ${report.summary.matchCount}, fresh mismatch ${report.summary.freshMismatchCount}, stored mismatch ${report.summary.storedMismatchCount}, missing stored ${report.summary.missingStoredCount}`,
  ];

  const visibleItems = options.showMatches
    ? report.items
    : report.items.filter((item) => item.status !== "match");
  if (visibleItems.length > 0) {
    lines.push("", "details:");
    for (const item of visibleItems) {
      lines.push(
        `- [${item.status}] ${item.label} (${item.metricKey}) | expected=${stringifyValue(item.expected)} | fresh=${stringifyValue(item.fresh)} | stored=${stringifyValue(item.stored)} | source=${item.source}`,
      );
      if (item.note) {
        lines.push(`  note=${item.note}`);
      }
    }
  }

  if (report.summary.unauditedMetricKeys.length > 0) {
    lines.push(
      "",
      `unaudited metrics: ${report.summary.unauditedMetricKeys.join(", ")}`,
    );
  }

  return lines.join("\n");
}
