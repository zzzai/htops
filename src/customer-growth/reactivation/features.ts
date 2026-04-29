import { extractConsumeCustomerRefs } from "../intelligence.js";
import { shiftBizDate } from "../../time.js";
import { HetangOpsStore } from "../../store.js";
import type {
  ConsumeBillRecord,
  CustomerPrimarySegment,
  CustomerSegmentRecord,
  MemberCardDailySnapshotRecord,
  MemberCardCurrentRecord,
  MemberCurrentRecord,
  MemberDailySnapshotRecord,
  MemberReactivationFeatureRecord,
  RechargeBillRecord,
} from "../../types.js";

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function normalizeText(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeIdentityValue(value: unknown): string | undefined {
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

function diffBizDays(leftBizDate: string, rightBizDate: string): number {
  const left = Date.parse(`${leftBizDate}T00:00:00Z`);
  const right = Date.parse(`${rightBizDate}T00:00:00Z`);
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    return 0;
  }
  return Math.max(0, Math.round((left - right) / 86_400_000));
}

type MemberVisitDaypart = "morning" | "afternoon" | "after-work" | "late-night" | "overnight";
type MemberVisitWeekday =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";
type MemberVisitMonthPhase = "early" | "mid" | "late";

type MemberVisitEvent = {
  settleKey: string;
  bizDate: string;
  occurredAtMs: number;
  localDate: string;
  localHour: number;
};

const REACTIVATION_REBUILD_CHUNK_DAYS = 7;

function parseLocalTimestampParts(value: string | undefined): {
  date: string;
  hour: number;
  minute: number;
  second: number;
} | null {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }
  const match = normalized.match(
    /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/u,
  );
  if (!match) {
    return null;
  }
  return {
    date: match[1]!,
    hour: match[2] === undefined ? 0 : Number(match[2]),
    minute: match[3] === undefined ? 0 : Number(match[3]),
    second: match[4] === undefined ? 0 : Number(match[4]),
  };
}

function resolveVisitEventTimestamp(optTime: string | undefined, bizDate: string): MemberVisitEvent | null {
  const parsed = parseLocalTimestampParts(optTime) ?? parseLocalTimestampParts(`${bizDate} 12:00:00`);
  if (!parsed) {
    return null;
  }
  const occurredAtMs = Date.parse(
    `${parsed.date}T${String(parsed.hour).padStart(2, "0")}:${String(parsed.minute).padStart(2, "0")}:${String(parsed.second).padStart(2, "0")}Z`,
  );
  if (!Number.isFinite(occurredAtMs)) {
    return null;
  }
  return {
    settleKey: "",
    bizDate,
    occurredAtMs,
    localDate: parsed.date,
    localHour: parsed.hour,
  };
}

function resolveVisitDaypart(localHour: number): MemberVisitDaypart {
  if (localHour < 3) {
    return "overnight";
  }
  if (localHour < 12) {
    return "morning";
  }
  if (localHour < 17) {
    return "afternoon";
  }
  if (localHour < 21) {
    return "after-work";
  }
  return "late-night";
}

function resolveVisitWeekday(localDate: string): MemberVisitWeekday {
  const weekday = new Date(`${localDate}T00:00:00Z`).getUTCDay();
  switch (weekday) {
    case 0:
      return "sunday";
    case 1:
      return "monday";
    case 2:
      return "tuesday";
    case 3:
      return "wednesday";
    case 4:
      return "thursday";
    case 5:
      return "friday";
    default:
      return "saturday";
  }
}

function resolveVisitMonthPhase(localDate: string): MemberVisitMonthPhase {
  const dayOfMonth = Number(localDate.slice(8, 10));
  if (dayOfMonth <= 10) {
    return "early";
  }
  if (dayOfMonth <= 20) {
    return "mid";
  }
  return "late";
}

function computeDominantBucketShare<T extends string>(counts: Map<T, number>): {
  dominant: T | null;
  share: number | null;
} {
  let dominant: T | null = null;
  let dominantCount = 0;
  let total = 0;
  for (const [bucket, count] of counts.entries()) {
    total += count;
    if (count > dominantCount || (count === dominantCount && dominant !== null && bucket < dominant)) {
      dominant = bucket;
      dominantCount = count;
    }
    if (dominant === null) {
      dominant = bucket;
      dominantCount = count;
    }
  }
  return {
    dominant,
    share: total > 0 ? round(dominantCount / total, 4) : null,
  };
}

function computeAverage(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return round(values.reduce((sum, value) => sum + value, 0) / values.length, 4);
}

function computeStddev(values: number[], average: number | null): number | null {
  if (values.length === 0 || average === null) {
    return null;
  }
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length;
  return round(Math.sqrt(variance), 4);
}

function resolveTimePreferenceConfidence(params: {
  preferredDaypartShare90d: number | null;
  preferredWeekdayShare90d: number | null;
  preferredMonthPhaseShare90d: number | null;
  visitCount90d: number;
}): number {
  if (params.visitCount90d <= 0) {
    return 0;
  }
  const daypartShare = params.preferredDaypartShare90d ?? 0;
  const weekdayShare = params.preferredWeekdayShare90d ?? 0;
  const monthPhaseShare = params.preferredMonthPhaseShare90d ?? 0;
  return round(
    Math.min(
      1,
      daypartShare * 0.5 + weekdayShare * 0.3 + monthPhaseShare * 0.2,
    ),
    4,
  );
}

function resolveCycleDeviationScore(params: {
  daysSinceLastVisit: number;
  averageVisitGapDays90d: number | null;
  visitGapStddevDays90d: number | null;
}): number | null {
  if (params.averageVisitGapDays90d === null || params.averageVisitGapDays90d <= 0) {
    return null;
  }
  const overdueDays = params.daysSinceLastVisit - params.averageVisitGapDays90d;
  if (overdueDays <= 0) {
    return 0;
  }
  const denominator = Math.max(
    params.averageVisitGapDays90d,
    params.visitGapStddevDays90d ?? 0,
    1,
  );
  return round(Math.min(3, overdueDays / denominator), 4);
}

function resolveBaseScore(primarySegment: CustomerPrimarySegment): number {
  switch (primarySegment) {
    case "important-reactivation-member":
      return 560;
    case "important-value-member":
      return 500;
    case "potential-growth-customer":
      return 420;
    case "groupbuy-retain-candidate":
      return 360;
    case "sleeping-customer":
      return 320;
    case "active-member":
      return 240;
    case "standard-customer":
      return 160;
    default:
      return 80;
  }
}

function resolveTrajectoryConfidence(params: {
  currentStoredBalanceInferred: number;
  storedBalance30dAgo: number | null;
  storedBalance90dAgo: number | null;
  memberPayAmount90d: number;
  rechargeCount90d: number;
  daysSinceLastRecharge: number | null;
}): number {
  let score = 0.3;
  if (params.currentStoredBalanceInferred >= 0) {
    score += 0.2;
  }
  if (params.storedBalance30dAgo !== null) {
    score += 0.2;
  }
  if (params.storedBalance90dAgo !== null) {
    score += 0.1;
  }
  if (params.memberPayAmount90d > 0) {
    score += 0.1;
  }
  if (params.rechargeCount90d > 0) {
    score += 0.05;
  }
  if (params.daysSinceLastRecharge !== null) {
    score += 0.05;
  }
  return round(Math.min(1, score), 4);
}

function resolveReactivationPriorityScore(params: {
  primarySegment: CustomerPrimarySegment;
  daysSinceLastVisit: number;
  payAmount90d: number;
  currentStoredBalanceInferred: number;
  storedBalanceDelta30d: number | null;
  storedBalanceDelta7d: number | null;
  projectedBalanceDaysLeft: number | null;
  cycleDeviationScore: number | null;
  timePreferenceConfidenceScore: number;
  trajectoryConfidenceScore: number;
}): number {
  const depletion30d = Math.max(0, -(params.storedBalanceDelta30d ?? 0));
  const depletion7d = Math.max(0, -(params.storedBalanceDelta7d ?? 0));
  return round(
    resolveBaseScore(params.primarySegment) +
      Math.min(params.payAmount90d, 3_000) / 18 +
      Math.min(params.currentStoredBalanceInferred, 3_000) / 24 +
      Math.min(depletion30d, 1_500) / 10 +
      Math.min(depletion7d, 800) / 8 +
      Math.min(params.daysSinceLastVisit, 120) * 0.8 +
      (params.projectedBalanceDaysLeft !== null && params.projectedBalanceDaysLeft <= 45 ? 30 : 0) +
      Math.min(Math.max(params.cycleDeviationScore ?? 0, 0), 3) * 22 +
      params.timePreferenceConfidenceScore * 18 +
      params.trajectoryConfidenceScore * 25,
    1,
  );
}

function buildMemberIdentityIndexes(params: {
  customerSegments: CustomerSegmentRecord[];
  memberSnapshots?: MemberDailySnapshotRecord[];
  memberCardSnapshots?: MemberCardDailySnapshotRecord[];
  currentMembers?: MemberCurrentRecord[];
  currentMemberCards?: MemberCardCurrentRecord[];
}) {
  const memberIdByCardNo = new Map<string, string>();
  const memberIdByCardId = new Map<string, string>();
  const memberIdByPhone = new Map<string, string>();

  for (const row of params.customerSegments) {
    if (!row.memberId) {
      continue;
    }
    const memberCardNo = normalizeIdentityValue(row.memberCardNo);
    if (memberCardNo) {
      memberIdByCardNo.set(memberCardNo, row.memberId);
    }
    const referenceCode = normalizeIdentityValue(row.referenceCode);
    if (referenceCode) {
      memberIdByCardNo.set(referenceCode, row.memberId);
    }
  }

  const latestMemberSnapshotByMemberId = new Map<string, MemberDailySnapshotRecord>();
  for (const member of params.memberSnapshots ?? []) {
    const current = latestMemberSnapshotByMemberId.get(member.memberId);
    if (!current || current.bizDate <= member.bizDate) {
      latestMemberSnapshotByMemberId.set(member.memberId, member);
    }
  }
  for (const member of latestMemberSnapshotByMemberId.values()) {
    const phone = normalizeIdentityValue(member.phone);
    if (phone) {
      memberIdByPhone.set(phone, member.memberId);
    }
  }

  const latestCardSnapshotByCardId = new Map<string, MemberCardDailySnapshotRecord>();
  for (const card of params.memberCardSnapshots ?? []) {
    const current = latestCardSnapshotByCardId.get(card.cardId);
    if (!current || current.bizDate <= card.bizDate) {
      latestCardSnapshotByCardId.set(card.cardId, card);
    }
  }
  for (const card of latestCardSnapshotByCardId.values()) {
    const cardNo = normalizeIdentityValue(card.cardNo);
    if (cardNo) {
      memberIdByCardNo.set(cardNo, card.memberId);
    }
    const cardId = normalizeIdentityValue(card.cardId);
    if (cardId) {
      memberIdByCardId.set(cardId, card.memberId);
    }
  }

  for (const member of params.currentMembers ?? []) {
    const phone = normalizeIdentityValue(member.phone);
    if (phone) {
      memberIdByPhone.set(phone, member.memberId);
    }
  }

  for (const card of params.currentMemberCards ?? []) {
    const cardNo = normalizeIdentityValue(card.cardNo);
    if (cardNo) {
      memberIdByCardNo.set(cardNo, card.memberId);
    }
    const cardId = normalizeIdentityValue(card.cardId);
    if (cardId) {
      memberIdByCardId.set(cardId, card.memberId);
    }
  }

  return { memberIdByCardNo, memberIdByCardId, memberIdByPhone };
}

function resolveMemberId(params: {
  memberIdByCardNo: Map<string, string>;
  memberIdByCardId: Map<string, string>;
  memberIdByPhone: Map<string, string>;
  referenceCode?: unknown;
  cardId?: unknown;
}): string | undefined {
  const referenceCode = normalizeIdentityValue(params.referenceCode);
  if (referenceCode) {
    return (
      params.memberIdByCardNo.get(referenceCode) ?? params.memberIdByPhone.get(referenceCode)
    );
  }
  const cardId = normalizeIdentityValue(params.cardId);
  if (cardId) {
    return params.memberIdByCardId.get(cardId);
  }
  return undefined;
}

function resolveConsumeMemberIds(params: {
  consumeBill: ConsumeBillRecord;
  memberIdByCardNo: Map<string, string>;
  memberIdByCardId: Map<string, string>;
  memberIdByPhone: Map<string, string>;
}): string[] {
  const refs = extractConsumeCustomerRefs(params.consumeBill.rawJson);
  const ids = new Set<string>();
  if (refs.length > 0) {
    for (const ref of refs) {
      const memberId = resolveMemberId({
        memberIdByCardNo: params.memberIdByCardNo,
        memberIdByCardId: params.memberIdByCardId,
        memberIdByPhone: params.memberIdByPhone,
        referenceCode: ref.referenceCode,
      });
      if (memberId) {
        ids.add(memberId);
      }
    }
  } else {
    const parsed = parseRawJson(params.consumeBill.rawJson);
    const memberId = resolveMemberId({
      memberIdByCardNo: params.memberIdByCardNo,
      memberIdByCardId: params.memberIdByCardId,
      memberIdByPhone: params.memberIdByPhone,
      referenceCode: parsed.CardNo ?? parsed.MemberPhone ?? parsed.Phone,
      cardId: parsed.CardId,
    });
    if (memberId) {
      ids.add(memberId);
    }
  }
  return Array.from(ids).sort((left, right) => left.localeCompare(right));
}

function extractMemberPaymentAmount(rawJson: string): number {
  const parsed = parseRawJson(rawJson);
  if (!Array.isArray(parsed.Payments)) {
    return 0;
  }
  return round(
    parsed.Payments.reduce((sum, payment) => {
      if (!payment || typeof payment !== "object" || Array.isArray(payment)) {
        return sum;
      }
      const name = String(payment.Name ?? "").trim();
      const paymentType = Number(payment.PaymentType);
      const amount = Number(payment.Amount ?? 0);
      if (!Number.isFinite(amount)) {
        return sum;
      }
      if (paymentType === 3 || name === "会员" || name.includes("会员")) {
        return sum + amount;
      }
      return sum;
    }, 0),
  );
}

function resolveBalanceAtOrBefore(
  snapshotsByMember: Map<string, MemberDailySnapshotRecord[]>,
  memberId: string,
  targetBizDate: string,
): number | null {
  const rows = snapshotsByMember.get(memberId) ?? [];
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row && row.bizDate <= targetBizDate) {
      return row.storedAmount;
    }
  }
  return null;
}

export function buildMemberReactivationFeaturesForBizDate(params: {
  orgId: string;
  bizDate: string;
  memberSnapshots: MemberDailySnapshotRecord[];
  memberCardSnapshots?: MemberCardDailySnapshotRecord[];
  customerSegments: CustomerSegmentRecord[];
  consumeBills: ConsumeBillRecord[];
  rechargeBills: RechargeBillRecord[];
  currentMembers?: MemberCurrentRecord[];
  currentMemberCards?: MemberCardCurrentRecord[];
}): MemberReactivationFeatureRecord[] {
  const start30BizDate = shiftBizDate(params.bizDate, -29);
  const start90BizDate = shiftBizDate(params.bizDate, -89);
  const indexes = buildMemberIdentityIndexes({
    customerSegments: params.customerSegments,
    memberSnapshots: params.memberSnapshots,
    memberCardSnapshots: params.memberCardSnapshots,
    currentMembers: params.currentMembers,
    currentMemberCards: params.currentMemberCards,
  });
  const snapshotsByMember = new Map<string, MemberDailySnapshotRecord[]>();
  for (const row of params.memberSnapshots) {
    const current = snapshotsByMember.get(row.memberId) ?? [];
    current.push(row);
    snapshotsByMember.set(row.memberId, current);
  }
  for (const rows of snapshotsByMember.values()) {
    rows.sort((left, right) => left.bizDate.localeCompare(right.bizDate));
  }

  const memberPay30d = new Map<string, number>();
  const memberPay90d = new Map<string, number>();
  const visitEventsByMember = new Map<string, MemberVisitEvent[]>();
  const seenVisitKeysByMember = new Map<string, Set<string>>();
  for (const consumeBill of params.consumeBills) {
    if (consumeBill.antiFlag || consumeBill.bizDate > params.bizDate) {
      continue;
    }
    const memberIds = resolveConsumeMemberIds({
      consumeBill,
      memberIdByCardNo: indexes.memberIdByCardNo,
      memberIdByCardId: indexes.memberIdByCardId,
      memberIdByPhone: indexes.memberIdByPhone,
    });
    if (memberIds.length !== 1) {
      continue;
    }
    const visitEvent = resolveVisitEventTimestamp(consumeBill.optTime, consumeBill.bizDate);
    const settleKey = consumeBill.settleNo ?? consumeBill.settleId;
    const memberPayShare = round(extractMemberPaymentAmount(consumeBill.rawJson), 4);
    for (const memberId of memberIds) {
      if (consumeBill.bizDate >= start90BizDate) {
        memberPay90d.set(memberId, round((memberPay90d.get(memberId) ?? 0) + memberPayShare, 4));
        if (visitEvent) {
          const seenVisitKeys = seenVisitKeysByMember.get(memberId) ?? new Set<string>();
          if (!seenVisitKeys.has(settleKey)) {
            seenVisitKeys.add(settleKey);
            seenVisitKeysByMember.set(memberId, seenVisitKeys);
            const currentEvents = visitEventsByMember.get(memberId) ?? [];
            currentEvents.push({
              ...visitEvent,
              settleKey,
            });
            visitEventsByMember.set(memberId, currentEvents);
          }
        }
      }
      if (consumeBill.bizDate >= start30BizDate) {
        memberPay30d.set(memberId, round((memberPay30d.get(memberId) ?? 0) + memberPayShare, 4));
      }
    }
  }

  const recharge30d = new Map<string, number>();
  const recharge90d = new Map<string, number>();
  const rechargeCount30d = new Map<string, number>();
  const rechargeCount90d = new Map<string, number>();
  const lastRechargeBizDateByMember = new Map<string, string>();

  for (const rechargeBill of params.rechargeBills) {
    if (rechargeBill.antiFlag || rechargeBill.bizDate > params.bizDate) {
      continue;
    }
    const parsed = parseRawJson(rechargeBill.rawJson);
    const memberId = resolveMemberId({
      memberIdByCardNo: indexes.memberIdByCardNo,
      memberIdByCardId: indexes.memberIdByCardId,
      memberIdByPhone: indexes.memberIdByPhone,
      referenceCode: parsed.CardNo ?? parsed.CCode ?? parsed.MemberPhone ?? parsed.Phone,
      cardId: parsed.CardId,
    });
    if (!memberId) {
      continue;
    }
    const previousLastRecharge = lastRechargeBizDateByMember.get(memberId);
    if (!previousLastRecharge || rechargeBill.bizDate > previousLastRecharge) {
      lastRechargeBizDateByMember.set(memberId, rechargeBill.bizDate);
    }
    if (rechargeBill.bizDate >= start90BizDate) {
      recharge90d.set(memberId, round((recharge90d.get(memberId) ?? 0) + rechargeBill.totalAmount, 4));
      rechargeCount90d.set(memberId, (rechargeCount90d.get(memberId) ?? 0) + 1);
    }
    if (rechargeBill.bizDate >= start30BizDate) {
      recharge30d.set(memberId, round((recharge30d.get(memberId) ?? 0) + rechargeBill.totalAmount, 4));
      rechargeCount30d.set(memberId, (rechargeCount30d.get(memberId) ?? 0) + 1);
    }
  }

  return params.customerSegments
    .filter((row) => row.memberId)
    .map((row) => {
      const memberId = row.memberId!;
      const currentStoredBalanceInferred =
        resolveBalanceAtOrBefore(snapshotsByMember, memberId, params.bizDate) ?? 0;
      const storedBalance7dAgo = resolveBalanceAtOrBefore(
        snapshotsByMember,
        memberId,
        shiftBizDate(params.bizDate, -7),
      );
      const storedBalance30dAgo = resolveBalanceAtOrBefore(
        snapshotsByMember,
        memberId,
        shiftBizDate(params.bizDate, -30),
      );
      const storedBalance90dAgo = resolveBalanceAtOrBefore(
        snapshotsByMember,
        memberId,
        shiftBizDate(params.bizDate, -90),
      );
      const storedBalanceDelta7d =
        storedBalance7dAgo === null ? null : round(currentStoredBalanceInferred - storedBalance7dAgo, 4);
      const storedBalanceDelta30d =
        storedBalance30dAgo === null ? null : round(currentStoredBalanceInferred - storedBalance30dAgo, 4);
      const storedBalanceDelta90d =
        storedBalance90dAgo === null ? null : round(currentStoredBalanceInferred - storedBalance90dAgo, 4);
      const depletionVelocity30d =
        storedBalanceDelta30d !== null && storedBalanceDelta30d < 0
          ? round(Math.abs(storedBalanceDelta30d) / 30, 4)
          : null;
      const projectedBalanceDaysLeft =
        depletionVelocity30d && depletionVelocity30d > 0
          ? round(currentStoredBalanceInferred / depletionVelocity30d, 2)
          : null;
      const resolvedMemberPayAmount90d = round(memberPay90d.get(memberId) ?? row.memberPayAmount90d, 4);
      const resolvedMemberPayAmount30d = round(memberPay30d.get(memberId) ?? 0, 4);
      const resolvedRechargeTotal90d = round(recharge90d.get(memberId) ?? 0, 4);
      const resolvedRechargeTotal30d = round(recharge30d.get(memberId) ?? 0, 4);
      const daysSinceLastRecharge = lastRechargeBizDateByMember.has(memberId)
        ? diffBizDays(params.bizDate, lastRechargeBizDateByMember.get(memberId)!)
        : null;
      const rechargeToMemberPayRatio90d =
        resolvedMemberPayAmount90d > 0
          ? round(resolvedRechargeTotal90d / resolvedMemberPayAmount90d, 4)
          : null;
      const visitEvents = [...(visitEventsByMember.get(memberId) ?? [])].sort(
        (left, right) => left.occurredAtMs - right.occurredAtMs || left.settleKey.localeCompare(right.settleKey),
      );
      const daypartCounts = new Map<MemberVisitDaypart, number>();
      const weekdayCounts = new Map<MemberVisitWeekday, number>();
      const monthPhaseCounts = new Map<MemberVisitMonthPhase, number>();
      let weekendVisitCount = 0;
      let lateNightVisitCount = 0;
      let overnightVisitCount = 0;
      for (const event of visitEvents) {
        const daypart = resolveVisitDaypart(event.localHour);
        const weekday = resolveVisitWeekday(event.localDate);
        const monthPhase = resolveVisitMonthPhase(event.localDate);
        daypartCounts.set(daypart, (daypartCounts.get(daypart) ?? 0) + 1);
        weekdayCounts.set(weekday, (weekdayCounts.get(weekday) ?? 0) + 1);
        monthPhaseCounts.set(monthPhase, (monthPhaseCounts.get(monthPhase) ?? 0) + 1);
        if (weekday === "saturday" || weekday === "sunday") {
          weekendVisitCount += 1;
        }
        if (daypart === "late-night") {
          lateNightVisitCount += 1;
        }
        if (daypart === "overnight") {
          overnightVisitCount += 1;
        }
      }
      const { dominant: dominantVisitDaypart, share: preferredDaypartShare90d } =
        computeDominantBucketShare(daypartCounts);
      const { dominant: dominantVisitWeekday, share: preferredWeekdayShare90d } =
        computeDominantBucketShare(weekdayCounts);
      const { dominant: dominantVisitMonthPhase, share: preferredMonthPhaseShare90d } =
        computeDominantBucketShare(monthPhaseCounts);
      const visitCount90dForTiming = visitEvents.length;
      const weekendVisitShare90d =
        visitCount90dForTiming > 0 ? round(weekendVisitCount / visitCount90dForTiming, 4) : null;
      const lateNightVisitShare90d =
        visitCount90dForTiming > 0 ? round(lateNightVisitCount / visitCount90dForTiming, 4) : null;
      const overnightVisitShare90d =
        visitCount90dForTiming > 0 ? round(overnightVisitCount / visitCount90dForTiming, 4) : null;
      const visitGapDays = visitEvents.slice(1).map((event, index) =>
        round((event.occurredAtMs - visitEvents[index]!.occurredAtMs) / 86_400_000, 4),
      );
      const averageVisitGapDays90d = computeAverage(visitGapDays);
      const visitGapStddevDays90d = computeStddev(visitGapDays, averageVisitGapDays90d);
      const cycleDeviationScore = resolveCycleDeviationScore({
        daysSinceLastVisit: row.daysSinceLastVisit,
        averageVisitGapDays90d,
        visitGapStddevDays90d,
      });
      const timePreferenceConfidenceScore = resolveTimePreferenceConfidence({
        preferredDaypartShare90d,
        preferredWeekdayShare90d,
        preferredMonthPhaseShare90d,
        visitCount90d: visitCount90dForTiming,
      });
      const trajectoryConfidenceScore = resolveTrajectoryConfidence({
        currentStoredBalanceInferred,
        storedBalance30dAgo,
        storedBalance90dAgo,
        memberPayAmount90d: resolvedMemberPayAmount90d,
        rechargeCount90d: rechargeCount90d.get(memberId) ?? 0,
        daysSinceLastRecharge,
      });
      const reactivationPriorityScore = resolveReactivationPriorityScore({
        primarySegment: row.primarySegment,
        daysSinceLastVisit: row.daysSinceLastVisit,
        payAmount90d: row.payAmount90d,
        currentStoredBalanceInferred,
        storedBalanceDelta30d,
        storedBalanceDelta7d,
        projectedBalanceDaysLeft,
        cycleDeviationScore,
        timePreferenceConfidenceScore,
        trajectoryConfidenceScore,
      });

      return {
        orgId: params.orgId,
        bizDate: params.bizDate,
        memberId,
        customerIdentityKey: row.customerIdentityKey,
        customerDisplayName: row.customerDisplayName,
        memberCardNo: row.memberCardNo,
        referenceCode: row.referenceCode,
        primarySegment: row.primarySegment,
        daysSinceLastVisit: row.daysSinceLastVisit,
        visitCount30d: row.visitCount30d,
        visitCount90d: row.visitCount90d,
        payAmount30d: row.payAmount30d,
        payAmount90d: row.payAmount90d,
        memberPayAmount30d: resolvedMemberPayAmount30d,
        memberPayAmount90d: resolvedMemberPayAmount90d,
        rechargeTotal30d: resolvedRechargeTotal30d,
        rechargeTotal90d: resolvedRechargeTotal90d,
        rechargeCount30d: rechargeCount30d.get(memberId) ?? 0,
        rechargeCount90d: rechargeCount90d.get(memberId) ?? 0,
        daysSinceLastRecharge,
        currentStoredBalanceInferred,
        storedBalance7dAgo,
        storedBalance30dAgo,
        storedBalance90dAgo,
        storedBalanceDelta7d,
        storedBalanceDelta30d,
        storedBalanceDelta90d,
        depletionVelocity30d,
        projectedBalanceDaysLeft,
        rechargeToMemberPayRatio90d,
        dominantVisitDaypart,
        preferredDaypartShare90d,
        dominantVisitWeekday,
        preferredWeekdayShare90d,
        dominantVisitMonthPhase,
        preferredMonthPhaseShare90d,
        weekendVisitShare90d,
        lateNightVisitShare90d,
        overnightVisitShare90d,
        averageVisitGapDays90d,
        visitGapStddevDays90d,
        cycleDeviationScore,
        timePreferenceConfidenceScore,
        trajectoryConfidenceScore,
        reactivationPriorityScore,
        featureJson: JSON.stringify({
          source: "inferred-stored-value-trajectory",
          anchors: {
            currentStoredBalanceInferred,
            storedBalance7dAgo,
            storedBalance30dAgo,
            storedBalance90dAgo,
          },
          timeBehavior: {
            dominantVisitDaypart,
            dominantVisitWeekday,
            dominantVisitMonthPhase,
            averageVisitGapDays90d,
            cycleDeviationScore,
          },
        }),
      } satisfies MemberReactivationFeatureRecord;
    })
    .sort(
      (left, right) =>
        right.reactivationPriorityScore - left.reactivationPriorityScore ||
        right.payAmount90d - left.payAmount90d ||
        left.memberId.localeCompare(right.memberId),
    );
}

async function rebuildMemberReactivationFeatureChunk(params: {
  store: HetangOpsStore;
  orgId: string;
  startBizDate: string;
  endBizDate: string;
}): Promise<number> {
  const historyStartBizDate = shiftBizDate(params.startBizDate, -90);
  const [memberSnapshots, memberCardSnapshots, consumeBills, rechargeBills] = await Promise.all([
    params.store.listMemberDailySnapshotsByDateRange(params.orgId, historyStartBizDate, params.endBizDate),
    params.store.listMemberCardDailySnapshotsByDateRange(
      params.orgId,
      historyStartBizDate,
      params.endBizDate,
    ),
    params.store.listConsumeBillsByDateRange(params.orgId, historyStartBizDate, params.endBizDate),
    params.store.listRechargeBillsByDateRange(params.orgId, historyStartBizDate, params.endBizDate),
  ]);

  let rewrittenDays = 0;
  for (
    let bizDate = params.startBizDate;
    bizDate <= params.endBizDate;
    bizDate = shiftBizDate(bizDate, 1)
  ) {
    const customerSegments = await params.store.listCustomerSegments(params.orgId, bizDate);
    const rows = buildMemberReactivationFeaturesForBizDate({
      orgId: params.orgId,
      bizDate,
      memberSnapshots: memberSnapshots.filter((row) => row.bizDate <= bizDate),
      memberCardSnapshots: memberCardSnapshots.filter((row) => row.bizDate <= bizDate),
      customerSegments,
      consumeBills: consumeBills.filter((row) => row.bizDate <= bizDate),
      rechargeBills: rechargeBills.filter((row) => row.bizDate <= bizDate),
    });
    await params.store.replaceMemberReactivationFeatures(
      params.orgId,
      bizDate,
      rows,
      new Date().toISOString(),
      { refreshViews: false },
    );
    rewrittenDays += 1;
  }

  return rewrittenDays;
}

export async function rebuildMemberReactivationFeaturesForDateRange(params: {
  store: HetangOpsStore;
  orgId: string;
  startBizDate: string;
  endBizDate: string;
  refreshViews?: boolean;
}): Promise<number> {
  let rebuiltDays = 0;
  for (let chunkStartBizDate = params.startBizDate; chunkStartBizDate <= params.endBizDate; ) {
    let chunkEndBizDate = shiftBizDate(chunkStartBizDate, REACTIVATION_REBUILD_CHUNK_DAYS - 1);
    if (chunkEndBizDate > params.endBizDate) {
      chunkEndBizDate = params.endBizDate;
    }
    rebuiltDays += await rebuildMemberReactivationFeatureChunk({
      store: params.store,
      orgId: params.orgId,
      startBizDate: chunkStartBizDate,
      endBizDate: chunkEndBizDate,
    });
    chunkStartBizDate = shiftBizDate(chunkEndBizDate, 1);
  }
  return rebuiltDays;
}
