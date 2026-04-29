import { HetangOpsStore } from "../store.js";
import {
  GROUPBUY_CONVERSION_WINDOW_30D,
  GROUPBUY_CONVERSION_WINDOW_7D,
  qualifiesHighValueMemberWindow,
  resolveCustomerGrowthPrimarySegmentThresholds,
} from "./semantics.js";
import { shiftBizDate } from "../time.js";
import { buildCustomerOperatingProfilesDaily } from "./customer-operating-profile.js";
import type {
  ConsumeBillRecord,
  ConsumeCustomerRef,
  CustomerConversionCohortRecord,
  CustomerOperatingProfileDailyRecord,
  CustomerOperatingSignalRecord,
  CustomerFrequencySegment,
  CustomerMonetarySegment,
  CustomerPaymentSegment,
  CustomerPrimarySegment,
  CustomerRecencySegment,
  CustomerSegmentRecord,
  CustomerTechLinkConfidence,
  CustomerTechLinkRecord,
  CustomerTechLoyaltySegment,
  CustomerIdentityType,
  HetangStoreConfig,
  MemberCardCurrentRecord,
  MemberCurrentRecord,
  MemberReactivationFeatureRecord,
  RechargeBillRecord,
  TechUpClockRecord,
} from "../types.js";

type ParsedPayment = {
  name: string;
  amount: number;
  paymentType: number | null;
};

type ResolvedCustomerIdentity = {
  customerIdentityKey: string;
  customerIdentityType: CustomerIdentityType;
  customerDisplayName: string;
  memberId?: string;
  memberCardNo?: string;
  referenceCode?: string;
  memberLabel?: string;
  identityStable: boolean;
  infoText: string;
};

type MemberIndexes = ReturnType<typeof buildMemberIndexes>;

type CustomerAggregation = Omit<
  CustomerSegmentRecord,
  | "bizDate"
  | "daysSinceLastVisit"
  | "recencySegment"
  | "frequencySegment"
  | "monetarySegment"
  | "paymentSegment"
  | "techLoyaltySegment"
  | "primarySegment"
  | "tagKeys"
  | "rawJson"
  | "segmentEligible"
> & {
  settleKeys30d: Set<string>;
  settleKeys90d: Set<string>;
  techVisits90d: Map<string, { count: number; techCode?: string; techName?: string }>;
};

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function uniqueSorted(values: Iterable<string | undefined>): string[] {
  return Array.from(
    new Set(Array.from(values).filter((value): value is string => Boolean(value))),
  ).sort((left, right) => left.localeCompare(right));
}

function normalizeText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeIdentityValue(value: string | undefined): string | undefined {
  const normalized = normalizeText(value)?.toLowerCase();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function parseRawJson(rawJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(rawJson) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function extractPayments(rawJson: string): ParsedPayment[] {
  const parsed = parseRawJson(rawJson);
  if (!Array.isArray(parsed.Payments)) {
    return [];
  }
  return parsed.Payments.reduce<ParsedPayment[]>((list, payment) => {
    if (!payment || typeof payment !== "object" || Array.isArray(payment)) {
      return list;
    }
    const name = String(payment.Name ?? "").trim();
    const amount = Number(payment.Amount ?? 0);
    const paymentType = Number(payment.PaymentType);
    if (!name || !Number.isFinite(amount)) {
      return list;
    }
    list.push({
      name,
      amount,
      paymentType: Number.isFinite(paymentType) ? paymentType : null,
    });
    return list;
  }, []);
}

function isMemberPayment(payment: ParsedPayment): boolean {
  return payment.paymentType === 3 || payment.name === "会员" || payment.name.includes("会员");
}

function isGroupbuyPayment(payment: ParsedPayment): boolean {
  return (
    payment.name === "美团" ||
    payment.name === "抖音" ||
    payment.name === "美团团购" ||
    payment.name === "抖音团购"
  );
}

function isDirectPayment(payment: ParsedPayment): boolean {
  return !isMemberPayment(payment) && !isGroupbuyPayment(payment);
}

function sumPayments(rawJson: string, matcher: (payment: ParsedPayment) => boolean): number {
  return round(
    extractPayments(rawJson).reduce((sum, payment) => {
      if (!matcher(payment)) {
        return sum;
      }
      return sum + payment.amount;
    }, 0),
  );
}

export function extractConsumeCustomerRefs(rawJson: string): ConsumeCustomerRef[] {
  const parsed = parseRawJson(rawJson);
  if (!Array.isArray(parsed.Infos)) {
    return [];
  }
  return parsed.Infos.reduce<ConsumeCustomerRef[]>((list, entry) => {
    const infoText = String(entry ?? "").trim();
    if (!infoText) {
      return list;
    }
    const leadText = infoText.split(",")[0]?.trim() ?? infoText;
    const memberLabel = normalizeText(leadText.match(/\(([^)]*)\)/u)?.[1]);
    const referenceCode = normalizeText(leadText.match(/\[([^\]]+)\]/u)?.[1]);
    const displayName = normalizeText(
      leadText
        .replace(/\([^)]*\)/gu, "")
        .replace(/\[[^\]]*\]/gu, "")
        .trim(),
    );
    list.push({
      displayName,
      memberLabel,
      referenceCode,
      infoText,
    });
    return list;
  }, []);
}

export function extractConsumeCustomerIdentityKeys(rawJson: string): string[] {
  const refs = extractConsumeCustomerRefs(rawJson);
  return uniqueSorted(
    refs.map((ref) => {
      const referenceCode = normalizeIdentityValue(ref.referenceCode);
      if (referenceCode) {
        return `customer-ref:${referenceCode}`;
      }
      const displayName = normalizeIdentityValue(ref.displayName);
      if (displayName) {
        return `display-name:${displayName}`;
      }
      return undefined;
    }),
  );
}

function buildMemberIndexes(params: {
  currentMembers: MemberCurrentRecord[];
  currentMemberCards: MemberCardCurrentRecord[];
}): {
  memberById: Map<string, MemberCurrentRecord>;
  memberIdByCardNo: Map<string, string>;
  memberIdByCardId: Map<string, string>;
  memberIdByPhone: Map<string, string>;
} {
  const memberById = new Map<string, MemberCurrentRecord>();
  const memberIdByCardNo = new Map<string, string>();
  const memberIdByCardId = new Map<string, string>();
  const memberIdByPhone = new Map<string, string>();
  for (const member of params.currentMembers) {
    memberById.set(member.memberId, member);
    const phone = normalizeIdentityValue(member.phone);
    if (phone) {
      memberIdByPhone.set(phone, member.memberId);
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
    memberIdByCardNo,
    memberIdByCardId,
    memberIdByPhone,
  };
}

function resolveMemberIdFromIdentity(params: {
  memberIndexes: MemberIndexes;
  referenceCode?: string;
  cardId?: string;
}): string | undefined {
  const normalizedReferenceCode = normalizeIdentityValue(params.referenceCode);
  if (normalizedReferenceCode) {
    const memberId =
      params.memberIndexes.memberIdByCardNo.get(normalizedReferenceCode) ??
      params.memberIndexes.memberIdByPhone.get(normalizedReferenceCode);
    if (memberId) {
      return memberId;
    }
  }

  const normalizedCardId = normalizeIdentityValue(params.cardId);
  if (normalizedCardId) {
    return params.memberIndexes.memberIdByCardId.get(normalizedCardId);
  }

  return undefined;
}

function resolveIdentityDisplayName(params: {
  member?: MemberCurrentRecord;
  displayName?: string;
  fallback?: string;
}): string {
  return normalizeText(params.member?.name) ?? normalizeText(params.displayName) ?? params.fallback ?? "未识别顾客";
}

function resolveReferenceCustomerIdentity(params: {
  settleLocalKey: string;
  memberIndexes: MemberIndexes;
  referenceCode?: string;
  cardId?: string;
  displayName?: string;
  memberLabel?: string;
  infoText?: string;
  fallbackDisplayName?: string;
}): ResolvedCustomerIdentity {
  const referenceCode = normalizeText(params.referenceCode);
  const displayName = normalizeText(params.displayName);
  const memberLabel = normalizeText(params.memberLabel);
  const memberId = resolveMemberIdFromIdentity({
    memberIndexes: params.memberIndexes,
    referenceCode,
    cardId: params.cardId,
  });
  const member = memberId ? params.memberIndexes.memberById.get(memberId) : undefined;

  if (memberId) {
    return {
      customerIdentityKey: `member:${memberId}`,
      customerIdentityType: "member",
      customerDisplayName: resolveIdentityDisplayName({
        member,
        displayName,
        fallback: params.fallbackDisplayName,
      }),
      memberId,
      memberCardNo: referenceCode,
      referenceCode,
      memberLabel,
      identityStable: true,
      infoText: params.infoText ?? "",
    };
  }

  const normalizedReferenceCode = normalizeIdentityValue(referenceCode);
  if (normalizedReferenceCode) {
    return {
      customerIdentityKey: `customer-ref:${normalizedReferenceCode}`,
      customerIdentityType: "customer-ref",
      customerDisplayName: resolveIdentityDisplayName({
        displayName,
        fallback: params.fallbackDisplayName,
      }),
      memberCardNo: referenceCode,
      referenceCode,
      memberLabel,
      identityStable: true,
      infoText: params.infoText ?? "",
    };
  }

  const normalizedDisplayName = normalizeIdentityValue(displayName);
  if (normalizedDisplayName) {
    return {
      customerIdentityKey: `display-name:${normalizedDisplayName}`,
      customerIdentityType: "display-name",
      customerDisplayName: displayName!,
      memberLabel,
      identityStable: false,
      infoText: params.infoText ?? "",
    };
  }

  return {
    customerIdentityKey: `settle-local:${params.settleLocalKey}`,
    customerIdentityType: "settle-local",
    customerDisplayName: params.fallbackDisplayName ?? "未识别顾客",
    identityStable: false,
    infoText: params.infoText ?? "",
  };
}

function resolveCustomerIdentity(params: {
  consumeBill: ConsumeBillRecord;
  ref: ConsumeCustomerRef | null;
  memberIndexes: ReturnType<typeof buildMemberIndexes>;
}): ResolvedCustomerIdentity {
  const settleLocalKey = params.consumeBill.settleNo ?? params.consumeBill.settleId;
  return resolveReferenceCustomerIdentity({
    settleLocalKey,
    memberIndexes: params.memberIndexes,
    referenceCode: params.ref?.referenceCode,
    displayName: params.ref?.displayName,
    memberLabel: params.ref?.memberLabel,
    infoText: params.ref?.infoText,
  });
}

function resolveConsumeCustomers(params: {
  consumeBill: ConsumeBillRecord;
  currentMembers: MemberCurrentRecord[];
  currentMemberCards: MemberCardCurrentRecord[];
}): ResolvedCustomerIdentity[] {
  const memberIndexes = buildMemberIndexes(params);
  const refs = extractConsumeCustomerRefs(params.consumeBill.rawJson);
  const parsed = parseRawJson(params.consumeBill.rawJson);
  const identities =
    refs.length > 0
        ? refs.map((ref) =>
          resolveCustomerIdentity({
            consumeBill: params.consumeBill,
            ref,
            memberIndexes,
          }),
        )
      : [
          resolveReferenceCustomerIdentity({
            settleLocalKey: params.consumeBill.settleNo ?? params.consumeBill.settleId,
            memberIndexes,
            // Live groupbuy rows frequently leave Infos empty and populate CCode/CName
            // with front-desk staff codes instead of the actual customer identity.
            referenceCode:
              String(parsed.CardNo ?? parsed.MemberPhone ?? parsed.Phone ?? "").trim() ||
              undefined,
            cardId: String(parsed.CardId ?? "").trim() || undefined,
            displayName:
              String(parsed.MemberName ?? parsed.Name ?? "").trim() || undefined,
            fallbackDisplayName: "未识别顾客",
          }),
        ];
  const seen = new Set<string>();
  return identities.filter((identity) => {
    if (seen.has(identity.customerIdentityKey)) {
      return false;
    }
    seen.add(identity.customerIdentityKey);
    return true;
  });
}

function resolveAttributableStableConsumeCustomers(params: {
  consumeBill: ConsumeBillRecord;
  currentMembers: MemberCurrentRecord[];
  currentMemberCards: MemberCardCurrentRecord[];
}): ResolvedCustomerIdentity[] {
  const stableCustomers = resolveConsumeCustomers(params).filter((identity) => identity.identityStable);
  return stableCustomers.length === 1 ? stableCustomers : [];
}

function resolveLinkConfidence(params: {
  customerCountInSettle: number;
  techCountInSettle: number;
}): CustomerTechLinkConfidence {
  if (params.customerCountInSettle <= 1) {
    return "single-customer";
  }
  if (params.techCountInSettle <= 1) {
    return "single-tech";
  }
  return "order-level-ambiguous";
}

export function buildCustomerTechServiceLinks(params: {
  orgId: string;
  bizDate: string;
  consumeBills: ConsumeBillRecord[];
  techUpClockRows: TechUpClockRecord[];
  currentMembers: MemberCurrentRecord[];
  currentMemberCards: MemberCardCurrentRecord[];
}): CustomerTechLinkRecord[] {
  const techBySettleNo = new Map<
    string,
    Map<
      string,
      {
        techCode: string;
        techName: string;
        turnover: number;
        commission: number;
        itemNames: Set<string>;
      }
    >
  >();
  for (const row of params.techUpClockRows) {
    const settleNo = normalizeText(row.settleNo);
    if (!settleNo) {
      continue;
    }
    const techMap =
      techBySettleNo.get(settleNo) ??
      new Map<
        string,
        {
          techCode: string;
          techName: string;
          turnover: number;
          commission: number;
          itemNames: Set<string>;
        }
      >();
    const current = techMap.get(row.personCode) ?? {
      techCode: row.personCode,
      techName: row.personName,
      turnover: 0,
      commission: 0,
      itemNames: new Set<string>(),
    };
    current.turnover = round(current.turnover + row.turnover);
    current.commission = round(current.commission + row.comm);
    if (row.itemName) {
      current.itemNames.add(row.itemName);
    }
    techMap.set(row.personCode, current);
    techBySettleNo.set(settleNo, techMap);
  }

  const links: CustomerTechLinkRecord[] = [];
  for (const consumeBill of params.consumeBills) {
    if (consumeBill.antiFlag) {
      continue;
    }
    const settleNo = normalizeText(consumeBill.settleNo);
    if (!settleNo) {
      continue;
    }
    const techMap = techBySettleNo.get(settleNo);
    if (!techMap || techMap.size === 0) {
      continue;
    }
    const customers = resolveConsumeCustomers({
      consumeBill,
      currentMembers: params.currentMembers,
      currentMemberCards: params.currentMemberCards,
    });
    const customerCountInSettle = customers.length;
    const techCountInSettle = techMap.size;
    const linkConfidence = resolveLinkConfidence({
      customerCountInSettle,
      techCountInSettle,
    });
    for (const customer of customers) {
      for (const tech of techMap.values()) {
        links.push({
          orgId: params.orgId,
          bizDate: consumeBill.bizDate,
          settleId: consumeBill.settleId,
          settleNo,
          customerIdentityKey: customer.customerIdentityKey,
          customerIdentityType: customer.customerIdentityType,
          customerDisplayName: customer.customerDisplayName,
          memberId: customer.memberId,
          memberCardNo: customer.memberCardNo,
          referenceCode: customer.referenceCode,
          memberLabel: customer.memberLabel,
          identityStable: customer.identityStable,
          techCode: tech.techCode,
          techName: tech.techName,
          customerCountInSettle,
          techCountInSettle,
          techTurnover: tech.turnover,
          techCommission: tech.commission,
          orderPayAmount: consumeBill.payAmount,
          orderConsumeAmount: consumeBill.consumeAmount,
          itemNames: Array.from(tech.itemNames).sort((left, right) => left.localeCompare(right)),
          linkConfidence,
          rawJson: JSON.stringify({
            infoText: customer.infoText,
            settleId: consumeBill.settleId,
            settleNo,
          }),
        });
      }
    }
  }

  return links.sort((left, right) =>
    [left.bizDate, left.settleNo ?? "", left.customerIdentityKey, left.techCode]
      .join("|")
      .localeCompare(
        [right.bizDate, right.settleNo ?? "", right.customerIdentityKey, right.techCode].join("|"),
      ),
  );
}

function isBizDateInRange(bizDate: string, startBizDate: string, endBizDate: string): boolean {
  return bizDate >= startBizDate && bizDate <= endBizDate;
}

function diffBizDays(laterBizDate: string, earlierBizDate: string): number {
  const later = new Date(`${laterBizDate}T00:00:00Z`);
  const earlier = new Date(`${earlierBizDate}T00:00:00Z`);
  return Math.max(0, Math.round((later.getTime() - earlier.getTime()) / 86_400_000));
}

function resolveRecencySegment(daysSinceLastVisit: number): CustomerRecencySegment {
  if (daysSinceLastVisit <= 7) {
    return "active-7d";
  }
  if (daysSinceLastVisit <= 30) {
    return "active-30d";
  }
  if (daysSinceLastVisit <= 90) {
    return "silent-31-90d";
  }
  if (daysSinceLastVisit <= 180) {
    return "sleeping-91-180d";
  }
  return "lost-180d-plus";
}

function resolveFrequencySegment(visitCount90d: number): CustomerFrequencySegment {
  if (visitCount90d >= 4) {
    return "high-4-plus";
  }
  if (visitCount90d >= 2) {
    return "medium-2-3";
  }
  if (visitCount90d >= 1) {
    return "low-1";
  }
  return "none";
}

function resolveMonetarySegment(payAmount90d: number): CustomerMonetarySegment {
  if (payAmount90d >= 1000) {
    return "high-1000-plus";
  }
  if (payAmount90d >= 300) {
    return "medium-300-999";
  }
  if (payAmount90d > 0) {
    return "low-1-299";
  }
  return "none";
}

function resolvePaymentSegment(params: {
  memberPayAmount90d: number;
  groupbuyAmount90d: number;
  directPayAmount90d: number;
}): CustomerPaymentSegment {
  const hasMember = params.memberPayAmount90d > 0;
  const hasGroupbuy = params.groupbuyAmount90d > 0;
  const hasDirect = params.directPayAmount90d > 0;
  if (hasMember && !hasGroupbuy && !hasDirect) {
    return "member-only";
  }
  if (hasGroupbuy && !hasMember && !hasDirect) {
    return "groupbuy-only";
  }
  if (hasMember && (hasGroupbuy || hasDirect)) {
    return "mixed-member-nonmember";
  }
  if (hasGroupbuy && hasDirect && !hasMember) {
    return "groupbuy-plus-direct";
  }
  if (hasDirect) {
    return "direct-only";
  }
  return "unknown";
}

function resolveTechLoyaltySegment(params: {
  distinctTechCount90d: number;
  topTechVisitShare90d: number | null;
  visitCount90d: number;
}): CustomerTechLoyaltySegment {
  if (params.distinctTechCount90d <= 0 || params.visitCount90d <= 0) {
    return "no-tech-link";
  }
  if ((params.topTechVisitShare90d ?? 0) >= 0.7 && params.visitCount90d >= 2) {
    return "single-tech-loyal";
  }
  return "multi-tech";
}

function resolvePrimarySegment(params: {
  identityStable: boolean;
  daysSinceLastVisit: number;
  visitCount90d: number;
  payAmount90d: number;
  memberPayAmount90d: number;
  groupbuyAmount90d: number;
  storeConfig?: HetangStoreConfig;
}): CustomerPrimarySegment {
  const thresholds = resolveCustomerGrowthPrimarySegmentThresholds(
    params.storeConfig?.customerGrowth?.primarySegmentThresholds,
  );
  const isHighValueMember = qualifiesHighValueMemberWindow({
    visitCount90d: params.visitCount90d,
    payAmount90d: params.payAmount90d,
    memberPayAmount90d: params.memberPayAmount90d,
    thresholds,
  });

  if (!params.identityStable) {
    return "unstable-identity";
  }
  if (isHighValueMember && params.daysSinceLastVisit <= thresholds.highValueMemberActiveMaxSilentDays) {
    return "important-value-member";
  }
  if (isHighValueMember) {
    return "important-reactivation-member";
  }
  if (
    params.daysSinceLastVisit <= thresholds.highValueMemberActiveMaxSilentDays &&
    params.payAmount90d >= thresholds.potentialGrowthPayAmount90d &&
    params.visitCount90d <= thresholds.potentialGrowthMaxVisitCount90d
  ) {
    return "potential-growth-customer";
  }
  if (
    params.daysSinceLastVisit <= thresholds.highValueMemberActiveMaxSilentDays &&
    params.groupbuyAmount90d > 0 &&
    params.memberPayAmount90d <= 0
  ) {
    return "groupbuy-retain-candidate";
  }
  if (params.daysSinceLastVisit > 90) {
    return "sleeping-customer";
  }
  if (
    params.daysSinceLastVisit <= thresholds.highValueMemberActiveMaxSilentDays &&
    params.memberPayAmount90d > 0
  ) {
    return "active-member";
  }
  return "standard-customer";
}

function buildTagKeys(params: {
  recencySegment: CustomerRecencySegment;
  frequencySegment: CustomerFrequencySegment;
  monetarySegment: CustomerMonetarySegment;
  paymentSegment: CustomerPaymentSegment;
  techLoyaltySegment: CustomerTechLoyaltySegment;
  primarySegment: CustomerPrimarySegment;
  identityStable: boolean;
  memberId?: string;
}): string[] {
  const tags = [
    params.primarySegment,
    params.recencySegment,
    params.frequencySegment,
    params.monetarySegment,
    params.paymentSegment,
    params.techLoyaltySegment,
    params.identityStable ? "identity-stable" : "identity-unstable",
  ];
  if (params.memberId) {
    tags.push("current-member");
  }
  return uniqueSorted(tags);
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

function resolveRechargeCustomerIdentity(params: {
  rechargeBill: RechargeBillRecord;
  currentMembers: MemberCurrentRecord[];
  currentMemberCards: MemberCardCurrentRecord[];
}): ResolvedCustomerIdentity | null {
  const memberIndexes = buildMemberIndexes(params);
  const parsed = parseRawJson(params.rechargeBill.rawJson);
  const identity = resolveReferenceCustomerIdentity({
    settleLocalKey: params.rechargeBill.rechargeId,
    memberIndexes,
    referenceCode:
      String(parsed.CardNo ?? parsed.CCode ?? parsed.MemberPhone ?? parsed.Phone ?? "").trim() ||
      undefined,
    cardId: String(parsed.CardId ?? "").trim() || undefined,
    displayName:
      String(parsed.MemberName ?? parsed.Name ?? params.rechargeBill.rechargeId).trim() || undefined,
    fallbackDisplayName: "未识别顾客",
  });
  return identity.identityStable ? identity : null;
}

type CustomerConversionEvent = {
  customerIdentityKey: string;
  customerIdentityType: CustomerIdentityType;
  customerDisplayName: string;
  memberId?: string;
  memberCardNo?: string;
  referenceCode?: string;
  settleId: string;
  settleNo?: string;
  bizDate: string;
  optTime: string;
  timeMs: number;
  payAmount: number;
  memberPayAmount: number;
  isGroupbuy: boolean;
};

export function buildCustomerConversionCohorts(params: {
  orgId: string;
  bizDate: string;
  consumeBills: ConsumeBillRecord[];
  rechargeBills: RechargeBillRecord[];
  currentMembers: MemberCurrentRecord[];
  currentMemberCards: MemberCardCurrentRecord[];
}): CustomerConversionCohortRecord[] {
  const lookbackStart = shiftBizDate(params.bizDate, -(GROUPBUY_CONVERSION_WINDOW_30D - 1));
  const memberCreatedAtByCustomer = new Map<string, number>();
  for (const member of params.currentMembers) {
    const createdAtMs = parseTimestampMs(member.createdTime);
    if (createdAtMs !== null) {
      memberCreatedAtByCustomer.set(`member:${member.memberId}`, createdAtMs);
    }
  }

  const rechargeTimesByCustomer = new Map<string, number[]>();
  for (const rechargeBill of params.rechargeBills) {
    if (
      rechargeBill.antiFlag ||
      rechargeBill.bizDate < lookbackStart ||
      rechargeBill.bizDate > params.bizDate
    ) {
      continue;
    }
    const identity = resolveRechargeCustomerIdentity({
      rechargeBill,
      currentMembers: params.currentMembers,
      currentMemberCards: params.currentMemberCards,
    });
    const timeMs = parseTimestampMs(rechargeBill.optTime);
    if (!identity || timeMs === null) {
      continue;
    }
    const times = rechargeTimesByCustomer.get(identity.customerIdentityKey) ?? [];
    times.push(timeMs);
    rechargeTimesByCustomer.set(identity.customerIdentityKey, times);
  }

  const eventsByCustomer = new Map<string, CustomerConversionEvent[]>();
  for (const consumeBill of params.consumeBills) {
    if (
      consumeBill.antiFlag ||
      consumeBill.bizDate < lookbackStart ||
      consumeBill.bizDate > params.bizDate
    ) {
      continue;
    }
    const customers = resolveAttributableStableConsumeCustomers({
      consumeBill,
      currentMembers: params.currentMembers,
      currentMemberCards: params.currentMemberCards,
    });
    const timeMs =
      parseTimestampMs(consumeBill.optTime) ?? parseTimestampMs(`${consumeBill.bizDate} 00:00:00`);
    if (customers.length === 0 || timeMs === null) {
      continue;
    }
    const memberPayAmount = sumPayments(consumeBill.rawJson, isMemberPayment);
    const isGroupbuy = sumPayments(consumeBill.rawJson, isGroupbuyPayment) > 0;
    for (const customer of customers) {
      const events = eventsByCustomer.get(customer.customerIdentityKey) ?? [];
      events.push({
        customerIdentityKey: customer.customerIdentityKey,
        customerIdentityType: customer.customerIdentityType,
        customerDisplayName: customer.customerDisplayName,
        memberId: customer.memberId,
        memberCardNo: customer.memberCardNo,
        referenceCode: customer.referenceCode,
        settleId: consumeBill.settleId,
        settleNo: consumeBill.settleNo,
        bizDate: consumeBill.bizDate,
        optTime: consumeBill.optTime,
        timeMs,
        payAmount: consumeBill.payAmount,
        memberPayAmount,
        isGroupbuy,
      });
      eventsByCustomer.set(customer.customerIdentityKey, events);
    }
  }

  const window7dMs = GROUPBUY_CONVERSION_WINDOW_7D * 24 * 60 * 60 * 1000;
  const window30dMs = GROUPBUY_CONVERSION_WINDOW_30D * 24 * 60 * 60 * 1000;

  const cohorts = Array.from(eventsByCustomer.values()).flatMap((events) => {
    const sortedEvents = [...events].sort((left, right) => {
      if (left.timeMs !== right.timeMs) {
        return left.timeMs - right.timeMs;
      }
      return `${left.settleNo ?? ""}|${left.settleId}`.localeCompare(
        `${right.settleNo ?? ""}|${right.settleId}`,
      );
    });
    const firstGroupbuy = sortedEvents.find((event) => event.isGroupbuy);
    if (!firstGroupbuy) {
      return [];
    }
    const laterEvents = sortedEvents.filter((event) => event.timeMs > firstGroupbuy.timeMs);
    const eventsWithin7d = laterEvents.filter(
      (event) => event.timeMs - firstGroupbuy.timeMs <= window7dMs,
    );
    const eventsWithin30dInclusive = sortedEvents.filter(
      (event) =>
        event.timeMs >= firstGroupbuy.timeMs && event.timeMs - firstGroupbuy.timeMs <= window30dMs,
    );
    const rechargeTimes = rechargeTimesByCustomer.get(firstGroupbuy.customerIdentityKey) ?? [];
    const hasRechargeWithin7d = rechargeTimes.some(
      (timeMs) => timeMs >= firstGroupbuy.timeMs && timeMs - firstGroupbuy.timeMs <= window7dMs,
    );
    const memberCreatedAtMs = memberCreatedAtByCustomer.get(firstGroupbuy.customerIdentityKey);
    const hasMemberCreatedWithin7d =
      memberCreatedAtMs !== undefined &&
      memberCreatedAtMs >= firstGroupbuy.timeMs &&
      memberCreatedAtMs - firstGroupbuy.timeMs <= window7dMs;
    const visitCount30dAfterGroupbuy = new Set(
      eventsWithin30dInclusive.map((event) => event.settleNo ?? event.settleId),
    ).size;
    const payAmount30dAfterGroupbuy = round(
      eventsWithin30dInclusive.reduce((sum, event) => sum + event.payAmount, 0),
    );
    const memberPayAmount30dAfterGroupbuy = round(
      eventsWithin30dInclusive.reduce((sum, event) => sum + event.memberPayAmount, 0),
    );

    return [
      {
        orgId: params.orgId,
        bizDate: params.bizDate,
        customerIdentityKey: firstGroupbuy.customerIdentityKey,
        customerIdentityType: firstGroupbuy.customerIdentityType,
        customerDisplayName: firstGroupbuy.customerDisplayName,
        memberId: firstGroupbuy.memberId,
        memberCardNo: firstGroupbuy.memberCardNo,
        referenceCode: firstGroupbuy.referenceCode,
        identityStable: true,
        firstGroupbuyBizDate: firstGroupbuy.bizDate,
        firstGroupbuyOptTime: firstGroupbuy.optTime,
        firstGroupbuySettleId: firstGroupbuy.settleId,
        firstGroupbuySettleNo: firstGroupbuy.settleNo,
        firstGroupbuyAmount: firstGroupbuy.payAmount,
        firstObservedBizDate: sortedEvents[0]?.bizDate,
        lastObservedBizDate: sortedEvents.at(-1)?.bizDate,
        firstObservedIsGroupbuy: sortedEvents[0]?.isGroupbuy ?? false,
        revisitWithin7d: eventsWithin7d.length > 0,
        revisitWithin30d: laterEvents.some(
          (event) => event.timeMs - firstGroupbuy.timeMs <= window30dMs,
        ),
        cardOpenedWithin7d:
          eventsWithin7d.some((event) => event.memberPayAmount > 0) ||
          hasMemberCreatedWithin7d ||
          hasRechargeWithin7d,
        storedValueConvertedWithin7d: hasRechargeWithin7d,
        memberPayConvertedWithin30d: laterEvents.some(
          (event) => event.timeMs - firstGroupbuy.timeMs <= window30dMs && event.memberPayAmount > 0,
        ),
        visitCount30dAfterGroupbuy,
        payAmount30dAfterGroupbuy,
        memberPayAmount30dAfterGroupbuy,
        highValueMemberWithin30d: qualifiesHighValueMemberWindow({
          visitCount90d: visitCount30dAfterGroupbuy,
          payAmount90d: payAmount30dAfterGroupbuy,
          memberPayAmount90d: memberPayAmount30dAfterGroupbuy,
        }),
        rawJson: JSON.stringify({
          settleKeys30d: Array.from(
            new Set(eventsWithin30dInclusive.map((event) => event.settleNo ?? event.settleId)),
          ).sort((left, right) => left.localeCompare(right)),
        }),
      } satisfies CustomerConversionCohortRecord,
    ];
  });

  return cohorts.sort((left, right) => {
    const leftBizDate = left.firstGroupbuyBizDate ?? "";
    const rightBizDate = right.firstGroupbuyBizDate ?? "";
    if (leftBizDate !== rightBizDate) {
      return leftBizDate.localeCompare(rightBizDate);
    }
    return left.customerIdentityKey.localeCompare(right.customerIdentityKey);
  });
}

export function buildCustomerSegments(params: {
  orgId: string;
  bizDate: string;
  consumeBills: ConsumeBillRecord[];
  customerTechLinks: CustomerTechLinkRecord[];
  currentMembers: MemberCurrentRecord[];
  currentMemberCards: MemberCardCurrentRecord[];
  storeConfig?: HetangStoreConfig;
}): CustomerSegmentRecord[] {
  const memberIndexes = buildMemberIndexes({
    currentMembers: params.currentMembers,
    currentMemberCards: params.currentMemberCards,
  });
  const start30 = shiftBizDate(params.bizDate, -29);
  const start90 = shiftBizDate(params.bizDate, -89);
  const aggregations = new Map<string, CustomerAggregation>();

  for (const consumeBill of params.consumeBills) {
    if (consumeBill.antiFlag || consumeBill.bizDate > params.bizDate) {
      continue;
    }
    const customers = resolveAttributableStableConsumeCustomers({
      consumeBill,
      currentMembers: params.currentMembers,
      currentMemberCards: params.currentMemberCards,
    });
    const memberPayAmount = sumPayments(consumeBill.rawJson, isMemberPayment);
    const groupbuyAmount = sumPayments(consumeBill.rawJson, isGroupbuyPayment);
    const directPayAmount = sumPayments(consumeBill.rawJson, isDirectPayment);
    const settleKey = consumeBill.settleNo ?? consumeBill.settleId;

    for (const customer of customers) {
      const current = aggregations.get(customer.customerIdentityKey) ?? {
        orgId: params.orgId,
        customerIdentityKey: customer.customerIdentityKey,
        customerIdentityType: customer.customerIdentityType,
        customerDisplayName:
          customer.memberId && memberIndexes.memberById.get(customer.memberId)?.name
            ? String(memberIndexes.memberById.get(customer.memberId)?.name)
            : customer.customerDisplayName,
        memberId: customer.memberId,
        memberCardNo: customer.memberCardNo,
        referenceCode: customer.referenceCode,
        memberLabel: customer.memberLabel,
        identityStable: customer.identityStable,
        firstBizDate: consumeBill.bizDate,
        lastBizDate: consumeBill.bizDate,
        visitCount30d: 0,
        visitCount90d: 0,
        payAmount30d: 0,
        payAmount90d: 0,
        memberPayAmount90d: 0,
        groupbuyAmount90d: 0,
        directPayAmount90d: 0,
        distinctTechCount90d: 0,
        topTechVisitCount90d: 0,
        topTechVisitShare90d: null,
        settleKeys30d: new Set<string>(),
        settleKeys90d: new Set<string>(),
        techVisits90d: new Map<string, { count: number; techCode?: string; techName?: string }>(),
      };
      if (consumeBill.bizDate < (current.firstBizDate ?? consumeBill.bizDate)) {
        current.firstBizDate = consumeBill.bizDate;
      }
      if (consumeBill.bizDate > (current.lastBizDate ?? consumeBill.bizDate)) {
        current.lastBizDate = consumeBill.bizDate;
      }
      if (isBizDateInRange(consumeBill.bizDate, start30, params.bizDate)) {
        current.settleKeys30d.add(settleKey);
        current.payAmount30d = round(current.payAmount30d + consumeBill.payAmount);
      }
      if (isBizDateInRange(consumeBill.bizDate, start90, params.bizDate)) {
        current.settleKeys90d.add(settleKey);
        current.payAmount90d = round(current.payAmount90d + consumeBill.payAmount);
        current.memberPayAmount90d = round(current.memberPayAmount90d + memberPayAmount);
        current.groupbuyAmount90d = round(current.groupbuyAmount90d + groupbuyAmount);
        current.directPayAmount90d = round(current.directPayAmount90d + directPayAmount);
      }
      aggregations.set(customer.customerIdentityKey, current);
    }
  }

  for (const link of params.customerTechLinks) {
    if (link.bizDate > params.bizDate || !isBizDateInRange(link.bizDate, start90, params.bizDate)) {
      continue;
    }
    const current = aggregations.get(link.customerIdentityKey);
    if (!current) {
      continue;
    }
    const techKey = link.techCode;
    const techVisit = current.techVisits90d.get(techKey) ?? {
      count: 0,
      techCode: link.techCode,
      techName: link.techName,
    };
    techVisit.count += 1;
    current.techVisits90d.set(techKey, techVisit);
  }

  const segments = Array.from(aggregations.values()).map((current) => {
    current.visitCount30d = current.settleKeys30d.size;
    current.visitCount90d = current.settleKeys90d.size;
    current.distinctTechCount90d = current.techVisits90d.size;
    const topTech = Array.from(current.techVisits90d.values()).sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return (left.techCode ?? "").localeCompare(right.techCode ?? "");
    })[0];
    current.topTechCode = topTech?.techCode;
    current.topTechName = topTech?.techName;
    current.topTechVisitCount90d = topTech?.count ?? 0;
    current.topTechVisitShare90d =
      current.visitCount90d > 0 ? round((topTech?.count ?? 0) / current.visitCount90d, 4) : null;

    const daysSinceLastVisit = diffBizDays(params.bizDate, current.lastBizDate ?? params.bizDate);
    const recencySegment = resolveRecencySegment(daysSinceLastVisit);
    const frequencySegment = resolveFrequencySegment(current.visitCount90d);
    const monetarySegment = resolveMonetarySegment(current.payAmount90d);
    const paymentSegment = resolvePaymentSegment({
      memberPayAmount90d: current.memberPayAmount90d,
      groupbuyAmount90d: current.groupbuyAmount90d,
      directPayAmount90d: current.directPayAmount90d,
    });
    const techLoyaltySegment = resolveTechLoyaltySegment({
      distinctTechCount90d: current.distinctTechCount90d,
      topTechVisitShare90d: current.topTechVisitShare90d,
      visitCount90d: current.visitCount90d,
    });
    const primarySegment = resolvePrimarySegment({
      identityStable: current.identityStable,
      daysSinceLastVisit,
      visitCount90d: current.visitCount90d,
      payAmount90d: current.payAmount90d,
      memberPayAmount90d: current.memberPayAmount90d,
      groupbuyAmount90d: current.groupbuyAmount90d,
      storeConfig: params.storeConfig,
    });
    const segmentEligible = current.identityStable;
    const tagKeys = buildTagKeys({
      recencySegment,
      frequencySegment,
      monetarySegment,
      paymentSegment,
      techLoyaltySegment,
      primarySegment,
      identityStable: current.identityStable,
      memberId: current.memberId,
    });

    return {
      orgId: params.orgId,
      bizDate: params.bizDate,
      customerIdentityKey: current.customerIdentityKey,
      customerIdentityType: current.customerIdentityType,
      customerDisplayName: current.customerDisplayName,
      memberId: current.memberId,
      memberCardNo: current.memberCardNo,
      referenceCode: current.referenceCode,
      memberLabel: current.memberLabel,
      identityStable: current.identityStable,
      segmentEligible,
      firstBizDate: current.firstBizDate,
      lastBizDate: current.lastBizDate,
      daysSinceLastVisit,
      visitCount30d: current.visitCount30d,
      visitCount90d: current.visitCount90d,
      payAmount30d: current.payAmount30d,
      payAmount90d: current.payAmount90d,
      memberPayAmount90d: current.memberPayAmount90d,
      groupbuyAmount90d: current.groupbuyAmount90d,
      directPayAmount90d: current.directPayAmount90d,
      distinctTechCount90d: current.distinctTechCount90d,
      topTechCode: current.topTechCode,
      topTechName: current.topTechName,
      topTechVisitCount90d: current.topTechVisitCount90d,
      topTechVisitShare90d: current.topTechVisitShare90d,
      recencySegment,
      frequencySegment,
      monetarySegment,
      paymentSegment,
      techLoyaltySegment,
      primarySegment,
      tagKeys,
      rawJson: JSON.stringify({
        settleKeys30d: Array.from(current.settleKeys30d).sort((left, right) =>
          left.localeCompare(right),
        ),
        settleKeys90d: Array.from(current.settleKeys90d).sort((left, right) =>
          left.localeCompare(right),
        ),
      }),
    } satisfies CustomerSegmentRecord;
  });

  return segments.sort((left, right) => {
    if (right.payAmount90d !== left.payAmount90d) {
      return right.payAmount90d - left.payAmount90d;
    }
    return left.customerIdentityKey.localeCompare(right.customerIdentityKey);
  });
}

function listBizDates(startBizDate: string, endBizDate: string): string[] {
  const dates: string[] = [];
  for (let cursor = startBizDate; cursor <= endBizDate; cursor = shiftBizDate(cursor, 1)) {
    dates.push(cursor);
  }
  return dates;
}

function listBizDateRanges(
  startBizDate: string,
  endBizDate: string,
  maxDaysPerRange: number,
): Array<{ startBizDate: string; endBizDate: string }> {
  const bizDates = listBizDates(startBizDate, endBizDate);
  const ranges: Array<{ startBizDate: string; endBizDate: string }> = [];
  for (let index = 0; index < bizDates.length; index += maxDaysPerRange) {
    const chunk = bizDates.slice(index, index + maxDaysPerRange);
    if (chunk.length === 0) {
      continue;
    }
    ranges.push({
      startBizDate: chunk[0],
      endBizDate: chunk[chunk.length - 1],
    });
  }
  return ranges;
}

export function buildCustomerIntelligenceArtifactsForBizDate(params: {
  orgId: string;
  bizDate: string;
  currentMembers: MemberCurrentRecord[];
  currentMemberCards: MemberCardCurrentRecord[];
  historyConsumeBills: ConsumeBillRecord[];
  historyRechargeBills: RechargeBillRecord[];
  historyTechUpClockRows: TechUpClockRecord[];
  storeConfig?: HetangStoreConfig;
}): {
  customerTechLinks: CustomerTechLinkRecord[];
  customerSegments: CustomerSegmentRecord[];
  customerConversionCohorts: CustomerConversionCohortRecord[];
} {
  const techHistoryStart = shiftBizDate(params.bizDate, -89);
  const cohortHistoryStart = shiftBizDate(params.bizDate, -(GROUPBUY_CONVERSION_WINDOW_30D - 1));
  const dayConsumeBills = params.historyConsumeBills.filter((row) => row.bizDate === params.bizDate);
  const historyConsumeBills = params.historyConsumeBills.filter((row) => row.bizDate <= params.bizDate);
  const techHistoryRows = params.historyTechUpClockRows.filter(
    (row) => row.bizDate >= techHistoryStart && row.bizDate <= params.bizDate,
  );
  const dayTechUpClockRows = techHistoryRows.filter((row) => row.bizDate === params.bizDate);
  const cohortRechargeBills = params.historyRechargeBills.filter(
    (row) => row.bizDate >= cohortHistoryStart && row.bizDate <= params.bizDate,
  );

  const customerTechLinks = buildCustomerTechServiceLinks({
    orgId: params.orgId,
    bizDate: params.bizDate,
    consumeBills: dayConsumeBills,
    techUpClockRows: dayTechUpClockRows,
    currentMembers: params.currentMembers,
    currentMemberCards: params.currentMemberCards,
  });
  const historyLinks = buildCustomerTechServiceLinks({
    orgId: params.orgId,
    bizDate: params.bizDate,
    consumeBills: historyConsumeBills.filter((row) => row.bizDate >= techHistoryStart),
    techUpClockRows: techHistoryRows,
    currentMembers: params.currentMembers,
    currentMemberCards: params.currentMemberCards,
  });
  const customerSegments = buildCustomerSegments({
    orgId: params.orgId,
    bizDate: params.bizDate,
    consumeBills: historyConsumeBills,
    customerTechLinks: historyLinks,
    currentMembers: params.currentMembers,
    currentMemberCards: params.currentMemberCards,
    storeConfig: params.storeConfig,
  });
  const customerConversionCohorts = buildCustomerConversionCohorts({
    orgId: params.orgId,
    bizDate: params.bizDate,
    consumeBills: historyConsumeBills.filter((row) => row.bizDate >= cohortHistoryStart),
    rechargeBills: cohortRechargeBills,
    currentMembers: params.currentMembers,
    currentMemberCards: params.currentMemberCards,
  });

  return {
    customerTechLinks,
    customerSegments,
    customerConversionCohorts,
  };
}

export function buildCustomerOperatingProfilesForBizDate(params: {
  orgId: string;
  bizDate: string;
  currentMembers: MemberCurrentRecord[];
  customerSegments: CustomerSegmentRecord[];
  reactivationFeatures: MemberReactivationFeatureRecord[];
  operatingSignals: CustomerOperatingSignalRecord[];
  updatedAt: string;
}): CustomerOperatingProfileDailyRecord[] {
  return buildCustomerOperatingProfilesDaily({
    orgId: params.orgId,
    bizDate: params.bizDate,
    updatedAt: params.updatedAt,
    currentMembers: params.currentMembers,
    customerSegments: params.customerSegments,
    reactivationFeatures: params.reactivationFeatures,
    operatingSignals: params.operatingSignals,
  });
}

export async function rebuildCustomerOperatingProfilesForBizDate(params: {
  store: HetangOpsStore;
  orgId: string;
  bizDate: string;
  updatedAt?: string;
  refreshViews?: boolean;
  signalLimit?: number;
}): Promise<CustomerOperatingProfileDailyRecord[]> {
  const snapshotEndBizDate = shiftBizDate(params.bizDate, 1);
  const [memberSnapshots, customerSegments, reactivationFeatures, operatingSignals] =
    await Promise.all([
      params.store.listMemberDailySnapshotsByDateRange(
        params.orgId,
        params.bizDate,
        snapshotEndBizDate,
      ),
      params.store.listCustomerSegments(params.orgId, params.bizDate),
      params.store.listMemberReactivationFeatures(params.orgId, params.bizDate),
      params.store.listCustomerOperatingSignals({
        orgId: params.orgId,
        limit: params.signalLimit ?? 50_000,
      }),
    ]);

  const membersByBizDate = groupRowsByBizDate(memberSnapshots);
  const currentMembers =
    membersByBizDate.get(params.bizDate) ?? membersByBizDate.get(snapshotEndBizDate) ?? [];
  const updatedAt = params.updatedAt ?? new Date().toISOString();
  const rows = buildCustomerOperatingProfilesForBizDate({
    orgId: params.orgId,
    bizDate: params.bizDate,
    currentMembers,
    customerSegments,
    reactivationFeatures,
    operatingSignals,
    updatedAt,
  });

  await params.store.replaceCustomerOperatingProfilesDaily(
    params.orgId,
    params.bizDate,
    rows,
    updatedAt,
    { refreshViews: params.refreshViews ?? false },
  );

  return rows;
}

function groupRowsByBizDate<T extends { bizDate: string }>(rows: T[]): Map<string, T[]> {
  const rowsByBizDate = new Map<string, T[]>();
  for (const row of rows) {
    const current = rowsByBizDate.get(row.bizDate) ?? [];
    current.push(row);
    rowsByBizDate.set(row.bizDate, current);
  }
  return rowsByBizDate;
}

export async function rebuildCustomerIntelligenceForBizDate(params: {
  store: HetangOpsStore;
  orgId: string;
  bizDate: string;
  updatedAt?: string;
  refreshViews?: boolean;
  storeConfig?: HetangStoreConfig;
}): Promise<{
  customerTechLinks: CustomerTechLinkRecord[];
  customerSegments: CustomerSegmentRecord[];
  customerConversionCohorts: CustomerConversionCohortRecord[];
}> {
  const historyStart = shiftBizDate(params.bizDate, -179);
  const techHistoryStart = shiftBizDate(params.bizDate, -89);
  const cohortHistoryStart = shiftBizDate(params.bizDate, -(GROUPBUY_CONVERSION_WINDOW_30D - 1));
  const snapshotEndBizDate = shiftBizDate(params.bizDate, 1);
  const [memberSnapshots, memberCardSnapshots, historyConsumeBills, historyRechargeBills, historyTechUpClockRows] =
    await Promise.all([
      params.store.listMemberDailySnapshotsByDateRange(
        params.orgId,
        params.bizDate,
        snapshotEndBizDate,
      ),
      params.store.listMemberCardDailySnapshotsByDateRange(
        params.orgId,
        params.bizDate,
        snapshotEndBizDate,
      ),
      params.store.listConsumeBillsByDateRange(params.orgId, historyStart, params.bizDate),
      params.store.listRechargeBillsByDateRange(params.orgId, cohortHistoryStart, params.bizDate),
      params.store.listTechUpClockByDateRange(params.orgId, techHistoryStart, params.bizDate),
    ]);
  const membersByBizDate = groupRowsByBizDate(memberSnapshots);
  const memberCardsByBizDate = groupRowsByBizDate(memberCardSnapshots);
  const currentMembers =
    membersByBizDate.get(params.bizDate) ?? membersByBizDate.get(snapshotEndBizDate) ?? [];
  const currentMemberCards =
    memberCardsByBizDate.get(params.bizDate) ?? memberCardsByBizDate.get(snapshotEndBizDate) ?? [];

  const artifacts = buildCustomerIntelligenceArtifactsForBizDate({
    orgId: params.orgId,
    bizDate: params.bizDate,
    currentMembers,
    currentMemberCards,
    historyConsumeBills,
    historyRechargeBills,
    historyTechUpClockRows,
    storeConfig: params.storeConfig,
  });

  const updatedAt = params.updatedAt ?? new Date().toISOString();
  await Promise.all([
    params.store.replaceCustomerTechLinks(
      params.orgId,
      params.bizDate,
      artifacts.customerTechLinks,
      updatedAt,
      { refreshViews: false },
    ),
    params.store.replaceCustomerSegments(
      params.orgId,
      params.bizDate,
      artifacts.customerSegments,
      updatedAt,
      { refreshViews: false },
    ),
    params.store.replaceCustomerConversionCohorts(
      params.orgId,
      params.bizDate,
      artifacts.customerConversionCohorts,
      updatedAt,
      { refreshViews: false },
    ),
  ]);
  if (params.refreshViews !== false) {
    await params.store.forceRebuildAnalyticsViews();
  }

  return artifacts;
}

export async function rebuildCustomerIntelligenceForDateRange(params: {
  store: HetangOpsStore;
  orgId: string;
  startBizDate: string;
  endBizDate: string;
  updatedAt?: string;
  refreshViews?: boolean;
  chunkDays?: number;
  storeConfig?: HetangStoreConfig;
}): Promise<number> {
  if (params.chunkDays && params.chunkDays > 0) {
    const ranges = listBizDateRanges(params.startBizDate, params.endBizDate, params.chunkDays);
    if (ranges.length > 1) {
      let rebuiltDays = 0;
      for (const range of ranges) {
        rebuiltDays += await rebuildCustomerIntelligenceForDateRange({
          ...params,
          startBizDate: range.startBizDate,
          endBizDate: range.endBizDate,
          refreshViews: false,
          chunkDays: undefined,
        });
      }
      if (params.refreshViews !== false) {
        await params.store.forceRebuildAnalyticsViews();
      }
      return rebuiltDays;
    }
  }

  const historyStart = shiftBizDate(params.startBizDate, -179);
  const techHistoryStart = shiftBizDate(params.startBizDate, -89);
  const cohortHistoryStart = shiftBizDate(params.startBizDate, -(GROUPBUY_CONVERSION_WINDOW_30D - 1));
  const [memberSnapshots, memberCardSnapshots, historyConsumeBills, historyRechargeBills, historyTechUpClockRows] =
    await Promise.all([
      params.store.listMemberDailySnapshotsByDateRange(
        params.orgId,
        params.startBizDate,
        params.endBizDate,
      ),
      params.store.listMemberCardDailySnapshotsByDateRange(
        params.orgId,
        params.startBizDate,
        params.endBizDate,
      ),
      params.store.listConsumeBillsByDateRange(params.orgId, historyStart, params.endBizDate),
      params.store.listRechargeBillsByDateRange(params.orgId, cohortHistoryStart, params.endBizDate),
      params.store.listTechUpClockByDateRange(params.orgId, techHistoryStart, params.endBizDate),
    ]);
  const membersByBizDate = groupRowsByBizDate(memberSnapshots);
  const memberCardsByBizDate = groupRowsByBizDate(memberCardSnapshots);

  const updatedAt = params.updatedAt ?? new Date().toISOString();
  const bizDates = listBizDates(params.startBizDate, params.endBizDate);
  for (const bizDate of bizDates) {
    const artifacts = buildCustomerIntelligenceArtifactsForBizDate({
      orgId: params.orgId,
      bizDate,
      currentMembers: membersByBizDate.get(bizDate) ?? [],
      currentMemberCards: memberCardsByBizDate.get(bizDate) ?? [],
      historyConsumeBills,
      historyRechargeBills,
      historyTechUpClockRows,
      storeConfig: params.storeConfig,
    });
    await params.store.replaceCustomerTechLinks(
      params.orgId,
      bizDate,
      artifacts.customerTechLinks,
      updatedAt,
      { refreshViews: false },
    );
    await params.store.replaceCustomerSegments(
      params.orgId,
      bizDate,
      artifacts.customerSegments,
      updatedAt,
      { refreshViews: false },
    );
    await params.store.replaceCustomerConversionCohorts(
      params.orgId,
      bizDate,
      artifacts.customerConversionCohorts,
      updatedAt,
      { refreshViews: false },
    );
  }

  if (params.refreshViews !== false) {
    await params.store.forceRebuildAnalyticsViews();
  }

  return bizDates.length;
}

export {
  buildMemberActionProfileBridge,
  buildMemberActionProfileBridgeIndex,
  resolveMemberActionProfileBridge,
} from "./action-profile-bridge.js";
