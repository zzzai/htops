import { createHash } from "node:crypto";
import mysql from "mysql2/promise";
import { resolveOperationalBizDateFromTimestamp, shiftBizDate } from "./time.js";
import type {
  ConsumeBillRecord,
  MemberCardCurrentRecord,
  MemberCurrentRecord,
  RechargeBillRecord,
  UserTradeRecord,
} from "./types.js";

const LEGACY_TIME_ZONE = "Asia/Shanghai";
const LEGACY_BIZDAY_CUTOFF = "03:00";
const LEGACY_YINGBIN_SOURCE_ORG_ID = 214001;
const LEGACY_YINGBIN_SCHEMAS = ["wwdb", "2"] as const;

export type LegacyCurrentCardRow = {
  ID: string;
  userid?: string | null;
  number?: string | null;
  balance?: number | string | null;
  expense?: number | string | null;
  mobile?: string | null;
  opentime?: string | null;
  LASTUSERTIME?: string | null;
  MCARD_NAME?: string | null;
  MCARD_TYPENAME?: string | null;
  ssbalance?: number | string | null;
  zsbalance?: number | string | null;
};

export type LegacySnapshotCardRow = LegacyCurrentCardRow & {
  BAKDATETIME?: string | null;
  BAKEXEDATETIME?: string | null;
};

export type LegacyRechargeRow = {
  exe_member_recharge_id: string;
  MCARDID?: string | null;
  NUMBER?: string | null;
  MONEY?: number | string | null;
  GIFTMONEY?: number | string | null;
  TOTALMONEY?: number | string | null;
  OPTIME?: string | null;
  CANCELFLAG?: number | string | null;
  MCARD_NAME?: string | null;
  MCARD_PHONE?: string | null;
  MCARD_TYPENAME?: string | null;
  RES_RECHARGETYPE_ID?: number | string | null;
};

export type LegacyConsumeItemRow = {
  EXE_CONSUMERITEMS_ID: string;
  EXE_SETTLEMENT_SHEET_SN?: string | null;
  ORDERPERSONNAME?: string | null;
  CONSUM_MONEY?: number | string | null;
  DISCOUNT_MONEY?: number | string | null;
  PAY_MONEY?: number | string | null;
  CANCELFLAG?: number | string | null;
  SETTLEMENT_TIME?: string | null;
  ROOMCODE?: string | null;
  SETTLEMENT_ID?: string | null;
};

export type LegacySettlementDetailRow = {
  EXE_SETTLEMENT_DETAIL_ID: number | string;
  EXE_CONSUMERITEMS_ID?: string | null;
  RES_SETTLEMENT_TYPE_ID?: number | string | null;
  MCARD_ID?: string | null;
  USEMONEY?: number | string | null;
  MCARD_NAME?: string | null;
  MCARD_PHONE?: string | null;
  MCARD_TYPENAME?: string | null;
  SETTLETIME?: string | null;
  xfsc?: number | string | null;
  xfzs?: number | string | null;
};

export type LegacyMysqlImportData = {
  currentCardRows: LegacyCurrentCardRow[];
  snapshotCardRows: LegacySnapshotCardRow[];
  rechargeRows: LegacyRechargeRow[];
  consumeRows: LegacyConsumeItemRow[];
  settlementRows: LegacySettlementDetailRow[];
  settlementTypeNameById: Map<number, string>;
  rechargeTypeNameById: Map<number, string>;
};

export type LegacyIdentityContext = {
  memberIdByCardNo: Map<string, string>;
  memberIdByPhone: Map<string, string>;
  existingCardNos: Set<string>;
  existingCardIds: Set<string>;
  existingMemberPhones: Set<string>;
};

type LegacyImportStore = {
  listCurrentMembers(orgId: string): Promise<MemberCurrentRecord[]>;
  listCurrentMemberCards(orgId: string): Promise<MemberCardCurrentRecord[]>;
  upsertMemberCurrent(rows: MemberCurrentRecord[]): Promise<void>;
  upsertMemberCards(rows: MemberCardCurrentRecord[]): Promise<void>;
  replaceMemberDailySnapshots(
    orgId: string,
    bizDate: string,
    rows: MemberCurrentRecord[],
  ): Promise<void>;
  replaceMemberCardDailySnapshots(
    orgId: string,
    bizDate: string,
    rows: MemberCardCurrentRecord[],
  ): Promise<void>;
  upsertRechargeBills(rows: RechargeBillRecord[]): Promise<void>;
  upsertConsumeBills(
    rows: ConsumeBillRecord[],
    options?: { refreshViews?: boolean },
  ): Promise<void>;
  upsertUserTrades(rows: UserTradeRecord[]): Promise<void>;
  forceRebuildAnalyticsViews(): Promise<void>;
};

type LegacyCurrentBuildParams<T extends LegacyCurrentCardRow> = {
  orgId: string;
  storeName: string;
  rows: T[];
  identityContext: LegacyIdentityContext;
};

export type LegacyMysqlConnectionOptions = {
  host: string;
  port: number;
  user: string;
  password?: string;
  legacyOrgId?: number;
  startTime?: string;
  endTime?: string;
  pageSize?: number;
};

function md5(value: string): string {
  return createHash("md5").update(value).digest("hex");
}

function text(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : undefined;
}

function numeric(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function flag(value: unknown): boolean {
  return numeric(value) === 1 || String(value ?? "").trim().toLowerCase() === "true";
}

function normalizePhone(value: unknown): string | undefined {
  const digits = String(value ?? "").replace(/\D/gu, "");
  return digits.length > 0 ? digits : undefined;
}

function normalizeIdentity(value: unknown): string | undefined {
  const normalized = text(value)?.toLowerCase();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function formatMoney(value: number): string {
  return value.toFixed(2);
}

function resolveBizDate(value: string | undefined): string | undefined {
  return value
    ? resolveOperationalBizDateFromTimestamp(value, LEGACY_TIME_ZONE, LEGACY_BIZDAY_CUTOFF)
    : undefined;
}

function compareTimestamp(left?: string, right?: string): number {
  const leftValue = left ?? "";
  const rightValue = right ?? "";
  return leftValue.localeCompare(rightValue);
}

function pickLatestRow<T>(left: T, right: T, timeSelector: (row: T) => string | undefined): T {
  return compareTimestamp(timeSelector(left), timeSelector(right)) >= 0 ? left : right;
}

function dedupeByKey<T>(
  rows: T[],
  keySelector: (row: T) => string | undefined,
  timeSelector?: (row: T) => string | undefined,
): T[] {
  const deduped = new Map<string, T>();
  for (const row of rows) {
    const key = keySelector(row);
    if (!key) {
      continue;
    }
    const current = deduped.get(key);
    if (!current) {
      deduped.set(key, row);
      continue;
    }
    deduped.set(
      key,
      timeSelector ? pickLatestRow(current, row, timeSelector) : current,
    );
  }
  return Array.from(deduped.values());
}

function appendRows<T>(target: T[], rows: T[]): void {
  for (const row of rows) {
    target.push(row);
  }
}

function buildCardRawJson(params: {
  orgId: string;
  row: LegacyCurrentCardRow;
}): Record<string, unknown> {
  const balance = numeric(params.row.balance);
  const realityBalance = numeric(params.row.ssbalance);
  const donateBalance = numeric(params.row.zsbalance);
  return {
    Id: params.row.ID,
    CardId: params.row.ID,
    CardNo: text(params.row.number),
    OrgId: params.orgId,
    Balance: balance,
    RealityBalance: realityBalance > 0 || donateBalance > 0 ? realityBalance : balance,
    DonateBalance: donateBalance,
    MemberName: text(params.row.MCARD_NAME),
    CardTypeName: text(params.row.MCARD_TYPENAME),
    Phone: normalizePhone(params.row.mobile),
    OpenTime: text(params.row.opentime),
    LastConsumeTime: text(params.row.LASTUSERTIME),
  };
}

function resolveLegacyMemberId(
  row: LegacyCurrentCardRow,
  identityContext: LegacyIdentityContext,
): string {
  const cardNo = normalizeIdentity(row.number);
  if (cardNo) {
    const resolved = identityContext.memberIdByCardNo.get(cardNo);
    if (resolved) {
      return resolved;
    }
  }

  const phone = normalizePhone(row.mobile);
  if (phone) {
    const resolved = identityContext.memberIdByPhone.get(phone);
    if (resolved) {
      return resolved;
    }
  }

  const legacyUserId = text(row.userid);
  if (legacyUserId) {
    return `legacy-user:${legacyUserId}`;
  }
  if (phone) {
    return `legacy-phone:${phone}`;
  }
  if (cardNo) {
    return `legacy-card:${cardNo}`;
  }
  return `legacy-row:${text(row.ID) ?? md5(JSON.stringify(row))}`;
}

function buildMemberRow(params: {
  orgId: string;
  storeName: string;
  memberId: string;
  rows: LegacyCurrentCardRow[];
}): MemberCurrentRecord {
  const cards = params.rows.map((row) => buildCardRawJson({ orgId: params.orgId, row }));
  const name = params.rows.map((row) => text(row.MCARD_NAME)).find(Boolean) ?? params.memberId;
  const phone = params.rows.map((row) => normalizePhone(row.mobile)).find(Boolean);
  const createdTime = params.rows
    .map((row) => text(row.opentime))
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => left.localeCompare(right))[0];
  const lastConsumeTime = params.rows
    .map((row) => text(row.LASTUSERTIME))
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => right.localeCompare(left))[0];
  const storedAmount = cards.reduce((sum, card) => sum + numeric(card.Balance), 0);
  const consumeAmount = params.rows.reduce((sum, row) => sum + numeric(row.expense), 0);
  const raw = {
    Id: params.memberId,
    Name: name,
    Phone: phone,
    OrgName: params.storeName,
    StoredAmount: storedAmount,
    ConsumeAmount: consumeAmount,
    CTime: createdTime,
    LastConsumeTime: lastConsumeTime,
    SilentDays: 0,
    Storeds: cards,
  };
  return {
    orgId: params.orgId,
    memberId: params.memberId,
    name,
    phone,
    storedAmount,
    consumeAmount,
    createdTime,
    lastConsumeTime,
    silentDays: 0,
    rawStoreName: params.storeName,
    rawJson: JSON.stringify(raw),
  };
}

function buildMemberCardRows(params: {
  orgId: string;
  memberId: string;
  rows: LegacyCurrentCardRow[];
}): MemberCardCurrentRecord[] {
  return params.rows.map((row) => ({
    orgId: params.orgId,
    memberId: params.memberId,
    cardId: String(row.ID),
    cardNo: text(row.number),
    rawJson: JSON.stringify(buildCardRawJson({ orgId: params.orgId, row })),
  }));
}

export function buildLegacyIdentityContext(params: {
  currentMembers: MemberCurrentRecord[];
  currentMemberCards: MemberCardCurrentRecord[];
}): LegacyIdentityContext {
  const memberIdByCardNo = new Map<string, string>();
  const memberIdByPhone = new Map<string, string>();
  const existingCardNos = new Set<string>();
  const existingCardIds = new Set<string>();
  const existingMemberPhones = new Set<string>();

  for (const member of params.currentMembers) {
    const phone = normalizePhone(member.phone);
    if (!phone) {
      continue;
    }
    memberIdByPhone.set(phone, member.memberId);
    existingMemberPhones.add(phone);
  }

  for (const card of params.currentMemberCards) {
    const cardNo = normalizeIdentity(card.cardNo);
    if (cardNo) {
      memberIdByCardNo.set(cardNo, card.memberId);
      existingCardNos.add(cardNo);
    }
    const cardId = normalizeIdentity(card.cardId);
    if (cardId) {
      existingCardIds.add(cardId);
    }
  }

  return {
    memberIdByCardNo,
    memberIdByPhone,
    existingCardNos,
    existingCardIds,
    existingMemberPhones,
  };
}

export function buildLegacyCurrentRows<T extends LegacyCurrentCardRow>(
  params: LegacyCurrentBuildParams<T>,
): {
  members: MemberCurrentRecord[];
  cards: MemberCardCurrentRecord[];
} {
  const dedupedRows = dedupeByKey(
    params.rows,
    (row) => normalizeIdentity(row.number) ?? text(row.ID),
    (row) => text(row.LASTUSERTIME) ?? text(row.opentime),
  );

  const rowsByMember = new Map<string, T[]>();
  for (const row of dedupedRows) {
    const memberId = resolveLegacyMemberId(row, params.identityContext);
    const current = rowsByMember.get(memberId) ?? [];
    current.push(row);
    rowsByMember.set(memberId, current);
  }

  const members: MemberCurrentRecord[] = [];
  const cards: MemberCardCurrentRecord[] = [];
  for (const [memberId, rows] of Array.from(rowsByMember.entries()).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    members.push(
      buildMemberRow({
        orgId: params.orgId,
        storeName: params.storeName,
        memberId,
        rows,
      }),
    );
    cards.push(
      ...buildMemberCardRows({
        orgId: params.orgId,
        memberId,
        rows,
      }),
    );
  }

  return { members, cards };
}

export function buildLegacySnapshotRows(params: LegacyCurrentBuildParams<LegacySnapshotCardRow>): {
  memberSnapshotsByBizDate: Map<string, MemberCurrentRecord[]>;
  cardSnapshotsByBizDate: Map<string, MemberCardCurrentRecord[]>;
} {
  const dedupedRows = dedupeByKey(
    params.rows,
    (row) =>
      [
        resolveBizDate(text(row.BAKDATETIME) ?? text(row.BAKEXEDATETIME)),
        normalizeIdentity(row.number) ?? text(row.ID),
      ]
        .filter(Boolean)
        .join("|"),
    (row) => text(row.BAKDATETIME) ?? text(row.BAKEXEDATETIME) ?? text(row.LASTUSERTIME),
  );
  const rowsByBizDate = new Map<string, LegacySnapshotCardRow[]>();
  for (const row of dedupedRows) {
    const bizDate = resolveBizDate(text(row.BAKDATETIME) ?? text(row.BAKEXEDATETIME));
    if (!bizDate) {
      continue;
    }
    const current = rowsByBizDate.get(bizDate) ?? [];
    current.push(row);
    rowsByBizDate.set(bizDate, current);
  }

  const memberSnapshotsByBizDate = new Map<string, MemberCurrentRecord[]>();
  const cardSnapshotsByBizDate = new Map<string, MemberCardCurrentRecord[]>();

  for (const [bizDate, rows] of Array.from(rowsByBizDate.entries()).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const current = buildLegacyCurrentRows({
      orgId: params.orgId,
      storeName: params.storeName,
      rows,
      identityContext: params.identityContext,
    });
    memberSnapshotsByBizDate.set(bizDate, current.members);
    cardSnapshotsByBizDate.set(bizDate, current.cards);
  }

  return {
    memberSnapshotsByBizDate,
    cardSnapshotsByBizDate,
  };
}

export function mapLegacyRechargeRows(params: {
  orgId: string;
  rows: LegacyRechargeRow[];
  rechargeTypeNameById: Map<number, string>;
}): RechargeBillRecord[] {
  const dedupedRows = dedupeByKey(
    params.rows,
    (row) => text(row.exe_member_recharge_id),
    (row) => text(row.OPTIME),
  );

  return dedupedRows
    .map((row) => {
      const rechargeId = text(row.exe_member_recharge_id);
      const optTime = text(row.OPTIME);
      if (!rechargeId || !optTime) {
        return null;
      }
      const typeId = numeric(row.RES_RECHARGETYPE_ID);
      const raw = {
        Id: rechargeId,
        CardId: text(row.MCARDID),
        CardNo: text(row.NUMBER) ?? text(row.MCARDID),
        MemberName: text(row.MCARD_NAME),
        MemberPhone: normalizePhone(row.MCARD_PHONE),
        CardTypeName: text(row.MCARD_TYPENAME),
        RechargeTypeName: params.rechargeTypeNameById.get(typeId),
        Type: typeId || undefined,
        Reality: numeric(row.MONEY),
        Donate: numeric(row.GIFTMONEY),
        Total: numeric(row.TOTALMONEY) || numeric(row.MONEY) + numeric(row.GIFTMONEY),
        OptTime: optTime,
        IsAnti: flag(row.CANCELFLAG),
      };
      return {
        orgId: params.orgId,
        rechargeId,
        realityAmount: numeric(row.MONEY),
        totalAmount: numeric(row.TOTALMONEY) || numeric(row.MONEY) + numeric(row.GIFTMONEY),
        donateAmount: numeric(row.GIFTMONEY),
        antiFlag: flag(row.CANCELFLAG),
        optTime,
        bizDate: resolveOperationalBizDateFromTimestamp(
          optTime,
          LEGACY_TIME_ZONE,
          LEGACY_BIZDAY_CUTOFF,
        ),
        rawJson: JSON.stringify(raw),
      } satisfies RechargeBillRecord;
    })
    .filter((row): row is RechargeBillRecord => Boolean(row));
}

function buildPaymentRows(params: {
  settlementRows: LegacySettlementDetailRow[];
  settlementTypeNameById: Map<number, string>;
}): Array<{ Name: string; Amount: number; PaymentType: number }> {
  return params.settlementRows.map((row) => {
    const paymentType = numeric(row.RES_SETTLEMENT_TYPE_ID);
    return {
      Name: params.settlementTypeNameById.get(paymentType) ?? `支付-${paymentType}`,
      Amount: numeric(row.USEMONEY),
      PaymentType: paymentType,
    };
  });
}

function buildConsumeInfoText(params: {
  memberName?: string;
  cardTypeName?: string;
  cardNo?: string;
  amount: number;
}): string[] {
  if (!params.memberName || !params.cardNo) {
    return [];
  }
  const label = params.cardTypeName ? ` (${params.cardTypeName})` : "";
  return [`${params.memberName}${label} [${params.cardNo}],消费${formatMoney(params.amount)}元;`];
}

export function buildLegacyConsumeRows(params: {
  orgId: string;
  consumeRows: LegacyConsumeItemRow[];
  settlementRows: LegacySettlementDetailRow[];
  settlementTypeNameById: Map<number, string>;
}): ConsumeBillRecord[] {
  const dedupedConsumeRows = dedupeByKey(
    params.consumeRows,
    (row) => text(row.EXE_CONSUMERITEMS_ID),
    (row) => text(row.SETTLEMENT_TIME),
  );
  const settlementRowsByConsumeId = params.settlementRows.reduce(
    (map, row) => {
      const consumeId = text(row.EXE_CONSUMERITEMS_ID);
      if (!consumeId) {
        return map;
      }
      const current = map.get(consumeId) ?? [];
      current.push(row);
      map.set(consumeId, current);
      return map;
    },
    new Map<string, LegacySettlementDetailRow[]>(),
  );

  const consumeBills: ConsumeBillRecord[] = [];
  for (const row of dedupedConsumeRows) {
    const settleId = text(row.EXE_CONSUMERITEMS_ID);
    const optTime = text(row.SETTLEMENT_TIME);
    if (!settleId || !optTime) {
      continue;
    }
    const settlementRows = settlementRowsByConsumeId.get(settleId) ?? [];
    const memberSettlement = settlementRows.find((entry) => text(entry.MCARD_ID));
    const raw = {
      SettleId: settleId,
      SettleNo: text(row.EXE_SETTLEMENT_SHEET_SN),
      Consume: numeric(row.CONSUM_MONEY),
      Pay: numeric(row.PAY_MONEY),
      DiscountAmount: numeric(row.DISCOUNT_MONEY),
      OptTime: optTime,
      Name: text(row.ORDERPERSONNAME) ?? text(memberSettlement?.MCARD_NAME),
      MemberName: text(memberSettlement?.MCARD_NAME),
      MemberPhone: normalizePhone(memberSettlement?.MCARD_PHONE),
      CardId: text(memberSettlement?.MCARD_ID),
      CardNo: text(memberSettlement?.MCARD_ID),
      CardTypeName: text(memberSettlement?.MCARD_TYPENAME),
      RoomCode: text(row.ROOMCODE),
      SettlementId: text(row.SETTLEMENT_ID),
      Payments: buildPaymentRows({
        settlementRows,
        settlementTypeNameById: params.settlementTypeNameById,
      }),
      Infos: buildConsumeInfoText({
        memberName: text(memberSettlement?.MCARD_NAME),
        cardTypeName: text(memberSettlement?.MCARD_TYPENAME),
        cardNo: text(memberSettlement?.MCARD_ID),
        amount: numeric(row.CONSUM_MONEY),
      }),
      IsAnti: flag(row.CANCELFLAG),
    };
    consumeBills.push({
      orgId: params.orgId,
      settleId,
      settleNo: text(row.EXE_SETTLEMENT_SHEET_SN),
      payAmount: numeric(row.PAY_MONEY),
      consumeAmount: numeric(row.CONSUM_MONEY),
      discountAmount: numeric(row.DISCOUNT_MONEY),
      antiFlag: flag(row.CANCELFLAG),
      optTime,
      bizDate: resolveOperationalBizDateFromTimestamp(
        optTime,
        LEGACY_TIME_ZONE,
        LEGACY_BIZDAY_CUTOFF,
      ),
      rawJson: JSON.stringify(raw),
    });
  }
  return consumeBills;
}

export function buildLegacyUserTradeRows(params: {
  orgId: string;
  rows: LegacySettlementDetailRow[];
}): UserTradeRecord[] {
  const dedupedRows = dedupeByKey(
    params.rows.filter((row) => Boolean(text(row.MCARD_ID)) && numeric(row.USEMONEY) !== 0),
    (row) => text(row.EXE_SETTLEMENT_DETAIL_ID),
    (row) => text(row.SETTLETIME),
  );

  const userTrades: UserTradeRecord[] = [];
  for (const row of dedupedRows) {
    const settleTime = text(row.SETTLETIME);
    const sourceConsumeId = text(row.EXE_CONSUMERITEMS_ID);
    const detailId = text(row.EXE_SETTLEMENT_DETAIL_ID);
    const cardNo = text(row.MCARD_ID);
    if (!settleTime || !sourceConsumeId || !detailId || !cardNo) {
      continue;
    }
    const tradeNo = `legacy-settle:${sourceConsumeId}:${detailId}`;
    const changeBalance = -Math.abs(numeric(row.USEMONEY));
    const changeReality = -Math.abs(numeric(row.xfsc));
    const changeDonate = -Math.abs(numeric(row.xfzs));
    const raw = {
      TradeNo: tradeNo,
      CardOptType: "legacy_consume_settle",
      OptTime: settleTime,
      CardId: cardNo,
      CardNo: cardNo,
      MemberName: text(row.MCARD_NAME),
      MemberPhone: normalizePhone(row.MCARD_PHONE),
      CardTypeName: text(row.MCARD_TYPENAME),
      PaymentType: "member-balance",
      ChangeBalance: changeBalance,
      ChangeReality: changeReality,
      ChangeDonate: changeDonate,
      ChangeIntegral: 0,
      SourceConsumeId: sourceConsumeId,
      IsAnti: false,
    };
    userTrades.push({
      orgId: params.orgId,
      rowFingerprint: md5(
        [
          params.orgId,
          tradeNo,
          settleTime,
          cardNo,
          changeBalance,
          changeReality,
          changeDonate,
        ].join("|"),
      ),
      tradeNo,
      optTime: settleTime,
      bizDate: resolveOperationalBizDateFromTimestamp(
        settleTime,
        LEGACY_TIME_ZONE,
        LEGACY_BIZDAY_CUTOFF,
      ),
      cardOptType: "legacy_consume_settle",
      changeBalance,
      changeReality,
      changeDonate,
      changeIntegral: 0,
      paymentType: "member-balance",
      antiFlag: false,
      rawJson: JSON.stringify(raw),
    });
  }
  return userTrades;
}

function filterMissingCurrentRows(params: {
  identityContext: LegacyIdentityContext;
  members: MemberCurrentRecord[];
  cards: MemberCardCurrentRecord[];
}): {
  members: MemberCurrentRecord[];
  cards: MemberCardCurrentRecord[];
} {
  const missingCards = params.cards.filter((card) => {
    const cardNo = normalizeIdentity(card.cardNo);
    const cardId = normalizeIdentity(card.cardId);
    return (
      (cardNo ? !params.identityContext.existingCardNos.has(cardNo) : true) &&
      (cardId ? !params.identityContext.existingCardIds.has(cardId) : true)
    );
  });

  const missingMemberIds = new Set(missingCards.map((card) => card.memberId));
  const missingMembers = params.members.filter((member) => {
    const phone = normalizePhone(member.phone);
    if (phone && params.identityContext.existingMemberPhones.has(phone)) {
      return false;
    }
    return missingMemberIds.has(member.memberId);
  });

  return {
    members: missingMembers,
    cards: missingCards,
  };
}

export async function importLegacyYingbinData(params: {
  orgId: string;
  storeName: string;
  store: LegacyImportStore;
  refreshViews?: boolean;
} & LegacyMysqlImportData): Promise<void> {
  const [currentMembers, currentMemberCards] = await Promise.all([
    params.store.listCurrentMembers(params.orgId),
    params.store.listCurrentMemberCards(params.orgId),
  ]);

  const identityContext = buildLegacyIdentityContext({
    currentMembers,
    currentMemberCards,
  });

  const current = buildLegacyCurrentRows({
    orgId: params.orgId,
    storeName: params.storeName,
    rows: params.currentCardRows,
    identityContext,
  });
  const missingCurrent = filterMissingCurrentRows({
    identityContext,
    members: current.members,
    cards: current.cards,
  });
  if (missingCurrent.members.length > 0) {
    await params.store.upsertMemberCurrent(missingCurrent.members);
  }
  if (missingCurrent.cards.length > 0) {
    await params.store.upsertMemberCards(missingCurrent.cards);
  }

  const snapshots = buildLegacySnapshotRows({
    orgId: params.orgId,
    storeName: params.storeName,
    rows: params.snapshotCardRows,
    identityContext,
  });
  for (const bizDate of Array.from(snapshots.memberSnapshotsByBizDate.keys()).sort((left, right) =>
    left.localeCompare(right),
  )) {
    await params.store.replaceMemberDailySnapshots(
      params.orgId,
      bizDate,
      snapshots.memberSnapshotsByBizDate.get(bizDate) ?? [],
    );
    await params.store.replaceMemberCardDailySnapshots(
      params.orgId,
      bizDate,
      snapshots.cardSnapshotsByBizDate.get(bizDate) ?? [],
    );
  }

  const rechargeRows = mapLegacyRechargeRows({
    orgId: params.orgId,
    rows: params.rechargeRows,
    rechargeTypeNameById: params.rechargeTypeNameById,
  });
  if (rechargeRows.length > 0) {
    await params.store.upsertRechargeBills(rechargeRows);
  }

  const consumeRows = buildLegacyConsumeRows({
    orgId: params.orgId,
    consumeRows: params.consumeRows,
    settlementRows: params.settlementRows,
    settlementTypeNameById: params.settlementTypeNameById,
  });
  if (consumeRows.length > 0) {
    await params.store.upsertConsumeBills(consumeRows, { refreshViews: false });
  }

  const userTrades = buildLegacyUserTradeRows({
    orgId: params.orgId,
    rows: params.settlementRows,
  });
  if (userTrades.length > 0) {
    await params.store.upsertUserTrades(userTrades);
  }

  if (params.refreshViews !== false) {
    await params.store.forceRebuildAnalyticsViews();
  }
}

export function listUncoveredBizDateRanges(params: {
  startBizDate: string;
  endBizDate: string;
  coveredBizDates: Set<string>;
}): Array<{ startBizDate: string; endBizDate: string }> {
  const ranges: Array<{ startBizDate: string; endBizDate: string }> = [];
  let rangeStart: string | undefined;
  let previousBizDate: string | undefined;

  for (
    let bizDate = params.startBizDate;
    bizDate <= params.endBizDate;
    bizDate = shiftBizDate(bizDate, 1)
  ) {
    if (!params.coveredBizDates.has(bizDate)) {
      rangeStart ??= bizDate;
      previousBizDate = bizDate;
      continue;
    }
    if (rangeStart && previousBizDate) {
      ranges.push({ startBizDate: rangeStart, endBizDate: previousBizDate });
      rangeStart = undefined;
      previousBizDate = undefined;
    }
  }

  if (rangeStart && previousBizDate) {
    ranges.push({ startBizDate: rangeStart, endBizDate: previousBizDate });
  }

  return ranges;
}

async function queryAllPages<T extends Record<string, unknown>>(params: {
  pool: mysql.Pool;
  sql: string;
  values: unknown[];
  pageSize: number;
}): Promise<T[]> {
  const rows: T[] = [];
  let offset = 0;
  while (true) {
    const [page] = await params.pool.query<(T & mysql.RowDataPacket)[]>(
      `${params.sql} LIMIT ${params.pageSize} OFFSET ${offset}`,
      params.values,
    );
    rows.push(...page.map((row) => ({ ...row })));
    if (page.length < params.pageSize) {
      break;
    }
    offset += params.pageSize;
  }
  return rows;
}

function buildRangePredicate(columnName: string, params: {
  startTime?: string;
  endTime?: string;
}): { sql: string; values: unknown[] } {
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (params.startTime) {
    clauses.push(`${columnName} >= ?`);
    values.push(params.startTime);
  }
  if (params.endTime) {
    clauses.push(`${columnName} <= ?`);
    values.push(params.endTime);
  }
  return {
    sql: clauses.length > 0 ? ` AND ${clauses.join(" AND ")}` : "",
    values,
  };
}

export async function loadLegacyYingbinDataFromMysql(
  options: LegacyMysqlConnectionOptions,
): Promise<LegacyMysqlImportData> {
  const pool = mysql.createPool({
    host: options.host,
    port: options.port,
    user: options.user,
    password: options.password,
    charset: "utf8mb4",
    dateStrings: true,
    waitForConnections: true,
    connectionLimit: 4,
  });

  try {
    const legacyOrgId = options.legacyOrgId ?? LEGACY_YINGBIN_SOURCE_ORG_ID;
    const pageSize = options.pageSize ?? 5000;
    const currentRows: LegacyCurrentCardRow[] = [];
    const snapshotRows: LegacySnapshotCardRow[] = [];
    const rechargeRows: LegacyRechargeRow[] = [];
    const consumeRows: LegacyConsumeItemRow[] = [];
    const settlementRows: LegacySettlementDetailRow[] = [];
    const settlementTypeNameById = new Map<number, string>();
    const rechargeTypeNameById = new Map<number, string>();

    for (const schema of LEGACY_YINGBIN_SCHEMAS) {
      const current = await queryAllPages<LegacyCurrentCardRow>({
        pool,
        sql: `SELECT * FROM \`${schema}\`.res_member_card_create WHERE company_id = ? ORDER BY ID`,
        values: [legacyOrgId],
        pageSize,
      });
      appendRows(currentRows, current);

      const snapshotRange = buildRangePredicate("BAKDATETIME", options);
      const snapshots = await queryAllPages<LegacySnapshotCardRow>({
        pool,
        sql:
          `SELECT * FROM \`${schema}\`.res_member_card_createbak WHERE company_id = ?${snapshotRange.sql} ORDER BY BAKDATETIME, REALID`,
        values: [legacyOrgId, ...snapshotRange.values],
        pageSize,
      });
      appendRows(snapshotRows, snapshots);

      const rechargeRange = buildRangePredicate("OPTIME", options);
      const recharge = await queryAllPages<LegacyRechargeRow>({
        pool,
        sql:
          `SELECT * FROM \`${schema}\`.exe_member_recharge WHERE ORG_ID = ?${rechargeRange.sql} ORDER BY OPTIME, exe_member_recharge_id`,
        values: [legacyOrgId, ...rechargeRange.values],
        pageSize,
      });
      appendRows(rechargeRows, recharge);

      const consumeRange = buildRangePredicate("SETTLEMENT_TIME", options);
      const consume = await queryAllPages<LegacyConsumeItemRow>({
        pool,
        sql:
          `SELECT * FROM \`${schema}\`.exe_consumeritems WHERE ORG_ID = ?${consumeRange.sql} ORDER BY SETTLEMENT_TIME, EXE_CONSUMERITEMS_ID`,
        values: [legacyOrgId, ...consumeRange.values],
        pageSize,
      });
      appendRows(consumeRows, consume);

      const settlementRange = buildRangePredicate("SETTLETIME", options);
      const settlement = await queryAllPages<LegacySettlementDetailRow>({
        pool,
        sql:
          `SELECT * FROM \`${schema}\`.exe_settlement_detail WHERE ORG_ID = ?${settlementRange.sql} ORDER BY SETTLETIME, EXE_SETTLEMENT_DETAIL_ID`,
        values: [legacyOrgId, ...settlementRange.values],
        pageSize,
      });
      appendRows(settlementRows, settlement);

      const [settlementTypes] = await pool.query<Array<Record<string, unknown> & mysql.RowDataPacket>>(
        `SELECT RES_SETTLEMENT_TYPE_ID, NAME FROM \`${schema}\`.res_settlement_type WHERE ORG_ID = ? OR ORG_ID = 1`,
        [legacyOrgId],
      );
      for (const row of settlementTypes) {
        const key = numeric(row.RES_SETTLEMENT_TYPE_ID);
        if (key > 0 && !settlementTypeNameById.has(key)) {
          settlementTypeNameById.set(key, String(row.NAME ?? "").trim());
        }
      }

      const [rechargeTypes] = await pool.query<Array<Record<string, unknown> & mysql.RowDataPacket>>(
        `SELECT RES_RECHARGETYPE_ID, NAME FROM \`${schema}\`.res_rechargetype`,
      );
      for (const row of rechargeTypes) {
        const key = numeric(row.RES_RECHARGETYPE_ID);
        if (key > 0 && !rechargeTypeNameById.has(key)) {
          rechargeTypeNameById.set(key, String(row.NAME ?? "").trim());
        }
      }
    }

    return {
      currentCardRows: dedupeByKey(
        currentRows,
        (row) => normalizeIdentity(row.number) ?? text(row.ID),
        (row) => text(row.LASTUSERTIME) ?? text(row.opentime),
      ),
      snapshotCardRows: dedupeByKey(
        snapshotRows,
        (row) =>
          [
            resolveBizDate(text(row.BAKDATETIME) ?? text(row.BAKEXEDATETIME)),
            normalizeIdentity(row.number) ?? text(row.ID),
          ]
            .filter(Boolean)
            .join("|"),
        (row) => text(row.BAKDATETIME) ?? text(row.BAKEXEDATETIME) ?? text(row.LASTUSERTIME),
      ),
      rechargeRows: dedupeByKey(
        rechargeRows,
        (row) => text(row.exe_member_recharge_id),
        (row) => text(row.OPTIME),
      ),
      consumeRows: dedupeByKey(
        consumeRows,
        (row) => text(row.EXE_CONSUMERITEMS_ID),
        (row) => text(row.SETTLEMENT_TIME),
      ),
      settlementRows: dedupeByKey(
        settlementRows,
        (row) => text(row.EXE_SETTLEMENT_DETAIL_ID),
        (row) => text(row.SETTLETIME),
      ),
      settlementTypeNameById,
      rechargeTypeNameById,
    };
  } finally {
    await pool.end();
  }
}
