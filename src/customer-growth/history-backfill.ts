import { extractConsumeCustomerRefs } from "./intelligence.js";
import { HetangOpsStore } from "../store.js";
import { resolveOperationalBizDateFromTimestamp, shiftBizDate } from "../time.js";
import type {
  ConsumeBillRecord,
  MemberCardCurrentRecord,
  MemberCurrentRecord,
  RechargeBillRecord,
} from "../types.js";

type MemberIndexes = {
  memberIdByCardNo: Map<string, string>;
  memberIdByCardId: Map<string, string>;
  memberIdByPhone: Map<string, string>;
};

type SnapshotDelta = {
  rechargeTotal: number;
  totalPay: number;
  memberPay: number;
  latestConsumeTime?: string;
};

type MemberConsumeTimelineEntry = {
  bizDate: string;
  latestConsumeTime: string;
};

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

function resolveBizDate(value: string | undefined, fallback: string): string {
  return value ? resolveOperationalBizDateFromTimestamp(value, "Asia/Shanghai", "03:00") : fallback;
}

function diffBizDays(leftBizDate: string, rightBizDate: string): number {
  const left = Date.parse(`${leftBizDate}T00:00:00Z`);
  const right = Date.parse(`${rightBizDate}T00:00:00Z`);
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    return 0;
  }
  return Math.max(0, Math.round((left - right) / 86_400_000));
}

function listBizDates(startBizDate: string, endBizDate: string): string[] {
  const dates: string[] = [];
  for (let cursor = startBizDate; cursor <= endBizDate; cursor = shiftBizDate(cursor, 1)) {
    dates.push(cursor);
  }
  return dates;
}

function buildMemberIndexes(params: {
  currentMembers: MemberCurrentRecord[];
  currentMemberCards: MemberCardCurrentRecord[];
}): MemberIndexes {
  const memberIdByCardNo = new Map<string, string>();
  const memberIdByCardId = new Map<string, string>();
  const memberIdByPhone = new Map<string, string>();

  for (const member of params.currentMembers) {
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
    memberIdByCardNo,
    memberIdByCardId,
    memberIdByPhone,
  };
}

function resolveMemberId(params: {
  indexes: MemberIndexes;
  referenceCode?: string;
  cardId?: string;
}): string | undefined {
  const referenceCode = normalizeIdentityValue(params.referenceCode);
  if (referenceCode) {
    const memberId =
      params.indexes.memberIdByCardNo.get(referenceCode) ??
      params.indexes.memberIdByPhone.get(referenceCode);
    if (memberId) {
      return memberId;
    }
  }

  const cardId = normalizeIdentityValue(params.cardId);
  if (cardId) {
    return params.indexes.memberIdByCardId.get(cardId);
  }

  return undefined;
}

function resolveMemberIdsFromConsumeBill(
  consumeBill: ConsumeBillRecord,
  indexes: MemberIndexes,
): string[] {
  const refs = extractConsumeCustomerRefs(consumeBill.rawJson);
  const parsed = parseRawJson(consumeBill.rawJson);
  const memberIds = new Set<string>();

  if (refs.length > 0) {
    for (const ref of refs) {
      const memberId = resolveMemberId({
        indexes,
        referenceCode: ref.referenceCode,
      });
      if (memberId) {
        memberIds.add(memberId);
      }
    }
  } else {
    const memberId = resolveMemberId({
      indexes,
      referenceCode:
        normalizeText(parsed.CardNo) ??
        normalizeText(parsed.MemberPhone) ??
        normalizeText(parsed.Phone),
      cardId: normalizeText(parsed.CardId),
    });
    if (memberId) {
      memberIds.add(memberId);
    }
  }

  return Array.from(memberIds).sort((left, right) => left.localeCompare(right));
}

function resolveMemberIdFromRechargeBill(
  rechargeBill: RechargeBillRecord,
  indexes: MemberIndexes,
): string | undefined {
  const parsed = parseRawJson(rechargeBill.rawJson);
  return resolveMemberId({
    indexes,
    referenceCode:
      normalizeText(parsed.CardNo) ??
      normalizeText(parsed.MemberPhone) ??
      normalizeText(parsed.Phone),
    cardId: normalizeText(parsed.CardId),
  });
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

function addDelta(
  deltas: Map<string, Map<string, SnapshotDelta>>,
  memberId: string,
  bizDate: string,
  delta: Partial<SnapshotDelta>,
): void {
  const memberDeltas = deltas.get(memberId) ?? new Map<string, SnapshotDelta>();
  const current = memberDeltas.get(bizDate) ?? {
    rechargeTotal: 0,
    totalPay: 0,
    memberPay: 0,
  };
  current.rechargeTotal = round(current.rechargeTotal + (delta.rechargeTotal ?? 0));
  current.totalPay = round(current.totalPay + (delta.totalPay ?? 0));
  current.memberPay = round(current.memberPay + (delta.memberPay ?? 0));
  if (delta.latestConsumeTime) {
    if (!current.latestConsumeTime || delta.latestConsumeTime > current.latestConsumeTime) {
      current.latestConsumeTime = delta.latestConsumeTime;
    }
  }
  memberDeltas.set(bizDate, current);
  deltas.set(memberId, memberDeltas);
}

function buildSnapshotRawJson(params: {
  member: MemberCurrentRecord;
  bizDate: string;
  storedAmount: number;
  consumeAmount: number;
  lastConsumeTime?: string;
  silentDays: number;
  futureRechargeTotal: number;
  futureTotalPay: number;
  futureMemberPay: number;
}): string {
  const parsed = parseRawJson(params.member.rawJson);
  parsed.StoredAmount = params.storedAmount;
  parsed.ConsumeAmount = params.consumeAmount;
  parsed.LastConsumeTime = params.lastConsumeTime ?? "";
  parsed.SilentDays = params.silentDays;
  parsed._backfill = {
    source: "transaction-reconstruction",
    bizDate: params.bizDate,
    futureRechargeTotal: params.futureRechargeTotal,
    futureTotalPay: params.futureTotalPay,
    futureMemberPay: params.futureMemberPay,
  };
  return JSON.stringify(parsed);
}

export async function streamReconstructedMemberSnapshotsByDate(params: {
  startBizDate: string;
  endBizDate: string;
  currentMembers: MemberCurrentRecord[];
  currentMemberCards: MemberCardCurrentRecord[];
  consumeBills: ConsumeBillRecord[];
  rechargeBills: RechargeBillRecord[];
  onDate: (bizDate: string, rows: MemberCurrentRecord[]) => Promise<void> | void;
}): Promise<number> {
  const indexes = buildMemberIndexes(params);
  const deltas = new Map<string, Map<string, SnapshotDelta>>();
  const latestConsumeTimelineByMember = new Map<string, MemberConsumeTimelineEntry[]>();

  for (const rechargeBill of params.rechargeBills) {
    if (rechargeBill.antiFlag) {
      continue;
    }
    const memberId = resolveMemberIdFromRechargeBill(rechargeBill, indexes);
    if (!memberId) {
      continue;
    }
    addDelta(deltas, memberId, rechargeBill.bizDate, {
      rechargeTotal: rechargeBill.totalAmount,
    });
  }

  for (const consumeBill of params.consumeBills) {
    if (consumeBill.antiFlag) {
      continue;
    }
    const memberIds = resolveMemberIdsFromConsumeBill(consumeBill, indexes);
    if (memberIds.length === 0) {
      continue;
    }
    const totalPayShare = round(consumeBill.payAmount / memberIds.length, 4);
    const memberPayShare = round(extractMemberPaymentAmount(consumeBill.rawJson) / memberIds.length, 4);
    for (const memberId of memberIds) {
      addDelta(deltas, memberId, consumeBill.bizDate, {
        totalPay: totalPayShare,
        memberPay: memberPayShare,
        latestConsumeTime: consumeBill.optTime,
      });

      const existingTimeline = latestConsumeTimelineByMember.get(memberId) ?? [];
      const latestEntry = existingTimeline.at(-1);
      if (latestEntry?.bizDate === consumeBill.bizDate) {
        if (consumeBill.optTime > latestEntry.latestConsumeTime) {
          latestEntry.latestConsumeTime = consumeBill.optTime;
        }
      } else {
        existingTimeline.push({
          bizDate: consumeBill.bizDate,
          latestConsumeTime: consumeBill.optTime,
        });
      }
      latestConsumeTimelineByMember.set(memberId, existingTimeline);
    }
  }

  const sortedMembers = [...params.currentMembers].sort((left, right) =>
    left.memberId.localeCompare(right.memberId),
  );
  const futureRechargeTotals = new Map<string, number>();
  const futureTotalPay = new Map<string, number>();
  const futureMemberPay = new Map<string, number>();
  const createdBizDateByMember = new Map<string, string>();
  const baselineLastConsumeTimeByMember = new Map<string, string | undefined>();
  const activeTimelineIndexByMember = new Map<string, number>();
  const activeLastConsumeTimeByMember = new Map<string, string | undefined>();

  for (const member of sortedMembers) {
    createdBizDateByMember.set(
      member.memberId,
      member.createdTime
        ? resolveBizDate(member.createdTime, params.startBizDate)
        : params.startBizDate,
    );
    const baselineLastConsumeTime =
      member.lastConsumeTime &&
      resolveBizDate(member.lastConsumeTime, params.startBizDate) < params.startBizDate
        ? member.lastConsumeTime
        : undefined;
    baselineLastConsumeTimeByMember.set(member.memberId, baselineLastConsumeTime);

    const timeline = latestConsumeTimelineByMember.get(member.memberId) ?? [];
    const activeIndex = timeline.length - 1;
    activeTimelineIndexByMember.set(member.memberId, activeIndex);
    activeLastConsumeTimeByMember.set(
      member.memberId,
      activeIndex >= 0 ? timeline[activeIndex]?.latestConsumeTime : baselineLastConsumeTime,
    );
  }

  const bizDates = listBizDates(params.startBizDate, params.endBizDate);
  let emittedDays = 0;

  for (let index = bizDates.length - 1; index >= 0; index -= 1) {
    const bizDate = bizDates[index];
    const rows: MemberCurrentRecord[] = [];

    for (const member of sortedMembers) {
      const createdBizDate = createdBizDateByMember.get(member.memberId) ?? params.startBizDate;
      if (createdBizDate > bizDate) {
        continue;
      }

      const futureRecharge = futureRechargeTotals.get(member.memberId) ?? 0;
      const futurePay = futureTotalPay.get(member.memberId) ?? 0;
      const futureStoredConsume = futureMemberPay.get(member.memberId) ?? 0;
      const storedAmount = round(Math.max(0, member.storedAmount - futureRecharge + futureStoredConsume));
      const consumeAmount = round(Math.max(0, member.consumeAmount - futurePay));
      const lastConsumeTime = activeLastConsumeTimeByMember.get(member.memberId);
      const referenceBizDate = lastConsumeTime
        ? resolveBizDate(lastConsumeTime, bizDate)
        : createdBizDate;
      const silentDays = diffBizDays(bizDate, referenceBizDate);

      rows.push({
        ...member,
        storedAmount,
        consumeAmount,
        lastConsumeTime,
        silentDays,
        rawJson: buildSnapshotRawJson({
          member,
          bizDate,
          storedAmount,
          consumeAmount,
          lastConsumeTime,
          silentDays,
          futureRechargeTotal: futureRecharge,
          futureTotalPay: futurePay,
          futureMemberPay: futureStoredConsume,
        }),
      });
    }

    await params.onDate(bizDate, rows);
    emittedDays += 1;

    for (const member of sortedMembers) {
      const delta = deltas.get(member.memberId)?.get(bizDate);
      if (!delta) {
        continue;
      }
      futureRechargeTotals.set(
        member.memberId,
        round((futureRechargeTotals.get(member.memberId) ?? 0) + delta.rechargeTotal),
      );
      futureTotalPay.set(
        member.memberId,
        round((futureTotalPay.get(member.memberId) ?? 0) + delta.totalPay),
      );
      futureMemberPay.set(
        member.memberId,
        round((futureMemberPay.get(member.memberId) ?? 0) + delta.memberPay),
      );
    }

    for (const member of sortedMembers) {
      const timeline = latestConsumeTimelineByMember.get(member.memberId);
      if (!timeline || timeline.length === 0) {
        continue;
      }
      const activeIndex = activeTimelineIndexByMember.get(member.memberId) ?? -1;
      if (activeIndex < 0 || timeline[activeIndex]?.bizDate !== bizDate) {
        continue;
      }
      const nextIndex = activeIndex - 1;
      activeTimelineIndexByMember.set(member.memberId, nextIndex);
      activeLastConsumeTimeByMember.set(
        member.memberId,
        nextIndex >= 0
          ? timeline[nextIndex]?.latestConsumeTime
          : baselineLastConsumeTimeByMember.get(member.memberId),
      );
    }
  }

  return emittedDays;
}

export function buildReconstructedMemberSnapshotsByDate(params: {
  startBizDate: string;
  endBizDate: string;
  currentMembers: MemberCurrentRecord[];
  currentMemberCards: MemberCardCurrentRecord[];
  consumeBills: ConsumeBillRecord[];
  rechargeBills: RechargeBillRecord[];
}): Map<string, MemberCurrentRecord[]> {
  const indexes = buildMemberIndexes(params);
  const deltas = new Map<string, Map<string, SnapshotDelta>>();

  for (const rechargeBill of params.rechargeBills) {
    if (rechargeBill.antiFlag) {
      continue;
    }
    const memberId = resolveMemberIdFromRechargeBill(rechargeBill, indexes);
    if (!memberId) {
      continue;
    }
    addDelta(deltas, memberId, rechargeBill.bizDate, {
      rechargeTotal: rechargeBill.totalAmount,
    });
  }

  for (const consumeBill of params.consumeBills) {
    if (consumeBill.antiFlag) {
      continue;
    }
    const memberIds = resolveMemberIdsFromConsumeBill(consumeBill, indexes);
    if (memberIds.length === 0) {
      continue;
    }
    const totalPayShare = round(consumeBill.payAmount / memberIds.length, 4);
    const memberPayShare = round(extractMemberPaymentAmount(consumeBill.rawJson) / memberIds.length, 4);
    for (const memberId of memberIds) {
      addDelta(deltas, memberId, consumeBill.bizDate, {
        totalPay: totalPayShare,
        memberPay: memberPayShare,
        latestConsumeTime: consumeBill.optTime,
      });
    }
  }

  const bizDates = listBizDates(params.startBizDate, params.endBizDate);
  const forwardLastConsumeByMember = new Map<string, Map<string, string | undefined>>();

  for (const member of params.currentMembers) {
    const memberDeltas = deltas.get(member.memberId) ?? new Map<string, SnapshotDelta>();
    const baselineLastConsumeTime =
      member.lastConsumeTime &&
      resolveBizDate(member.lastConsumeTime, params.startBizDate) < params.startBizDate
        ? member.lastConsumeTime
        : undefined;
    const byDate = new Map<string, string | undefined>();
    let lastConsumeTime = baselineLastConsumeTime;
    for (const bizDate of bizDates) {
      const delta = memberDeltas.get(bizDate);
      if (delta?.latestConsumeTime && (!lastConsumeTime || delta.latestConsumeTime > lastConsumeTime)) {
        lastConsumeTime = delta.latestConsumeTime;
      }
      byDate.set(bizDate, lastConsumeTime);
    }
    forwardLastConsumeByMember.set(member.memberId, byDate);
  }

  const snapshotsByDate = new Map<string, MemberCurrentRecord[]>();
  const futureRechargeTotals = new Map<string, number>();
  const futureTotalPay = new Map<string, number>();
  const futureMemberPay = new Map<string, number>();

  for (let index = bizDates.length - 1; index >= 0; index -= 1) {
    const bizDate = bizDates[index];
    const rows: MemberCurrentRecord[] = [];
    for (const member of params.currentMembers) {
      const createdBizDate = member.createdTime
        ? resolveBizDate(member.createdTime, bizDate)
        : params.startBizDate;
      if (createdBizDate > bizDate) {
        continue;
      }
      const futureRecharge = futureRechargeTotals.get(member.memberId) ?? 0;
      const futurePay = futureTotalPay.get(member.memberId) ?? 0;
      const futureStoredConsume = futureMemberPay.get(member.memberId) ?? 0;
      const storedAmount = round(Math.max(0, member.storedAmount - futureRecharge + futureStoredConsume));
      const consumeAmount = round(Math.max(0, member.consumeAmount - futurePay));
      const lastConsumeTime = forwardLastConsumeByMember.get(member.memberId)?.get(bizDate);
      const referenceBizDate = lastConsumeTime
        ? resolveBizDate(lastConsumeTime, bizDate)
        : createdBizDate;
      const silentDays = diffBizDays(bizDate, referenceBizDate);
      rows.push({
        ...member,
        storedAmount,
        consumeAmount,
        lastConsumeTime,
        silentDays,
        rawJson: buildSnapshotRawJson({
          member,
          bizDate,
          storedAmount,
          consumeAmount,
          lastConsumeTime,
          silentDays,
          futureRechargeTotal: futureRecharge,
          futureTotalPay: futurePay,
          futureMemberPay: futureStoredConsume,
        }),
      });
    }
    snapshotsByDate.set(bizDate, rows.sort((left, right) => left.memberId.localeCompare(right.memberId)));

    for (const member of params.currentMembers) {
      const delta = deltas.get(member.memberId)?.get(bizDate);
      if (!delta) {
        continue;
      }
      futureRechargeTotals.set(
        member.memberId,
        round((futureRechargeTotals.get(member.memberId) ?? 0) + delta.rechargeTotal),
      );
      futureTotalPay.set(
        member.memberId,
        round((futureTotalPay.get(member.memberId) ?? 0) + delta.totalPay),
      );
      futureMemberPay.set(
        member.memberId,
        round((futureMemberPay.get(member.memberId) ?? 0) + delta.memberPay),
      );
    }
  }

  return snapshotsByDate;
}

export async function rebuildMemberDailySnapshotsForDateRange(params: {
  store: HetangOpsStore;
  orgId: string;
  startBizDate: string;
  endBizDate: string;
}): Promise<number> {
  const [
    anchorMemberSnapshots,
    anchorMemberCardSnapshots,
    currentMembers,
    currentMemberCards,
    consumeBills,
    rechargeBills,
  ] = await Promise.all([
    params.store.listMemberDailySnapshotsByDateRange(
      params.orgId,
      params.endBizDate,
      params.endBizDate,
    ),
    params.store.listMemberCardDailySnapshotsByDateRange(
      params.orgId,
      params.endBizDate,
      params.endBizDate,
    ),
    params.store.listCurrentMembers(params.orgId),
    params.store.listCurrentMemberCards(params.orgId),
    params.store.listConsumeBillsByDateRange(params.orgId, params.startBizDate, params.endBizDate),
    params.store.listRechargeBillsByDateRange(params.orgId, params.startBizDate, params.endBizDate),
  ]);
  const anchorMembers = anchorMemberSnapshots.length > 0 ? anchorMemberSnapshots : currentMembers;
  const anchorCards = anchorMemberCardSnapshots.length > 0 ? anchorMemberCardSnapshots : currentMemberCards;

  return streamReconstructedMemberSnapshotsByDate({
    startBizDate: params.startBizDate,
    endBizDate: params.endBizDate,
    currentMembers: anchorMembers,
    currentMemberCards: anchorCards,
    consumeBills,
    rechargeBills,
    onDate: async (bizDate, rows) => {
      await params.store.replaceMemberDailySnapshots(params.orgId, bizDate, rows);
      const activeMemberIds = new Set(rows.map((row) => row.memberId));
      await params.store.replaceMemberCardDailySnapshots(
        params.orgId,
        bizDate,
        anchorCards.filter((card) => activeMemberIds.has(card.memberId)),
      );
    },
  });
}
