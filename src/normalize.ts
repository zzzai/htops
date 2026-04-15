import { createHash } from "node:crypto";
import { extractBizDate } from "./time.js";
import {
  type ConsumeBillRecord,
  type MemberCardCurrentRecord,
  type MemberCurrentRecord,
  type RechargeBillRecord,
  type TechCommissionSnapshotRecord,
  type TechCurrentRecord,
  type TechMarketRecord,
  type TechUpClockRecord,
  type UserTradeRecord,
} from "./types.js";

function md5(value: string): string {
  return createHash("md5").update(value).digest("hex");
}

function text(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const resolved = String(value).trim();
  return resolved.length > 0 ? resolved : undefined;
}

function number(value: unknown): number {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function sumStoredCardBalances(storeds: unknown): number | null {
  if (!Array.isArray(storeds)) {
    return null;
  }
  const balances = storeds
    .filter(
      (entry): entry is Record<string, unknown> =>
        Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
    )
    .map((entry) => {
      const directBalance = number(entry.Balance);
      if (directBalance > 0) {
        return directBalance;
      }
      const realityBalance = number(entry.RealityBalance);
      const donateBalance = number(entry.DonateBalance);
      return realityBalance + donateBalance;
    });
  if (balances.length === 0) {
    return null;
  }
  return balances.reduce((sum, value) => sum + value, 0);
}

function flag(value: unknown): boolean {
  return number(value) === 1 || String(value ?? "").toLowerCase() === "true";
}

export function normalizeMemberRow(
  row: Record<string, unknown>,
  orgId: string,
): MemberCurrentRecord | null {
  const memberId = text(row.Id);
  if (!memberId) {
    return null;
  }
  const storedBalance = sumStoredCardBalances(row.Storeds);
  return {
    orgId,
    memberId,
    name: text(row.Name) ?? memberId,
    phone: text(row.Phone),
    storedAmount: storedBalance ?? number(row.StoredAmount ?? row.Assets),
    consumeAmount: number(row.ConsumeAmount),
    createdTime: text(row.CTime),
    lastConsumeTime: text(row.LastConsumeTime),
    silentDays: number(row.SilentDays),
    rawStoreName: text(row.OrgName),
    rawJson: JSON.stringify(row),
  };
}

export function normalizeMemberCardRows(
  row: Record<string, unknown>,
  orgId: string,
): MemberCardCurrentRecord[] {
  const memberId = text(row.Id);
  if (!memberId || !Array.isArray(row.Storeds)) {
    return [];
  }
  return row.Storeds.filter(
    (entry): entry is Record<string, unknown> =>
      Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
  )
    .filter((entry) => {
      const cardOrgId = text(entry.OrgId);
      return !cardOrgId || cardOrgId === orgId;
    })
    .map((entry) => {
      const cardId = text(entry.Id);
      if (!cardId) {
        return null;
      }
      return {
        orgId,
        memberId,
        cardId,
        cardNo: text(entry.CardNo),
        rawJson: JSON.stringify(entry),
      };
    })
    .filter((entry): entry is MemberCardCurrentRecord => Boolean(entry));
}

export function normalizeConsumeBillRow(
  row: Record<string, unknown>,
  orgId: string,
  timeZone: string,
  now: Date,
  cutoffLocalTime = "03:00",
): ConsumeBillRecord | null {
  const settleId = text(row.SettleId);
  const optTime = text(row.OptTime) ?? text(row.CTime);
  if (!settleId || !optTime) {
    return null;
  }
  return {
    orgId,
    settleId,
    settleNo: text(row.SettleNo),
    payAmount: number(row.Pay),
    consumeAmount: number(row.Consume),
    discountAmount: number(row.DiscountAmount),
    antiFlag: flag(row.IsAnti),
    optTime,
    bizDate: extractBizDate(optTime, timeZone, now, cutoffLocalTime),
    rawJson: JSON.stringify(row),
  };
}

export function normalizeRechargeBillRow(
  row: Record<string, unknown>,
  orgId: string,
  timeZone: string,
  now: Date,
  cutoffLocalTime = "03:00",
): RechargeBillRecord | null {
  const rechargeId = text(row.Id);
  const optTime = text(row.OptTime);
  if (!rechargeId || !optTime) {
    return null;
  }
  return {
    orgId,
    rechargeId,
    realityAmount: number(row.Reality ?? row.Pay),
    totalAmount: number(row.Total ?? row.Reality),
    donateAmount: number(row.Donate),
    antiFlag: flag(row.IsAnti),
    optTime,
    bizDate: extractBizDate(optTime, timeZone, now, cutoffLocalTime),
    rawJson: JSON.stringify(row),
  };
}

export function normalizeUserTradeRow(
  row: Record<string, unknown>,
  orgId: string,
  timeZone: string,
  now: Date,
  cutoffLocalTime = "03:00",
): UserTradeRecord | null {
  const optTime = text(row.OptTime);
  if (!optTime) {
    return null;
  }
  const fingerprint = md5(
    [
      orgId,
      text(row.TradeNo) ?? "",
      optTime,
      text(row.CardOptType) ?? "",
      number(row.ChangeBalance),
      number(row.ChangeReality),
      number(row.ChangeDonate),
      number(row.ChangeIntegral),
      text(row.PaymentType) ?? "",
    ].join("|"),
  );
  return {
    orgId,
    rowFingerprint: fingerprint,
    tradeNo: text(row.TradeNo),
    optTime,
    bizDate: extractBizDate(optTime, timeZone, now, cutoffLocalTime),
    cardOptType: text(row.CardOptType),
    changeBalance: number(row.ChangeBalance),
    changeReality: number(row.ChangeReality),
    changeDonate: number(row.ChangeDonate),
    changeIntegral: number(row.ChangeIntegral),
    paymentType: text(row.PaymentType),
    antiFlag: flag(row.IsAnti),
    rawJson: JSON.stringify(row),
  };
}

export function normalizeTechCurrentRow(
  row: Record<string, unknown>,
  orgId: string,
): TechCurrentRecord | null {
  const techCode = text(row.Code);
  if (!techCode) {
    return null;
  }
  return {
    orgId,
    techCode,
    techName: text(row.Name) ?? techCode,
    isWork: flag(row.IsWork),
    isJob: flag(row.IsJob),
    pointClockNum: number(row.PointClockNum),
    wheelClockNum: number(row.WheelClockNum),
    baseWages: number(row.BaseWages),
    rawStoreName: text(row.OrgName),
    rawJson: JSON.stringify(row),
  };
}

export function normalizeTechUpClockRow(
  row: Record<string, unknown>,
  orgId: string,
  timeZone: string,
  now: Date,
  cutoffLocalTime = "03:00",
): TechUpClockRecord | null {
  const personCode = text(row.PersonCode);
  const ctime = text(row.CTime);
  if (!personCode || !ctime) {
    return null;
  }
  const fingerprint = md5(
    [
      orgId,
      personCode,
      text(row.SettleNo) ?? "",
      text(row.HandCardCode) ?? "",
      text(row.ItemName) ?? "",
      ctime,
      text(row.ClockType) ?? "",
      number(row.Count),
      number(row.Turnover),
      number(row.Comm),
    ].join("|"),
  );
  const settleTime = text(row.SettleTime) ?? ctime;
  return {
    orgId,
    rowFingerprint: fingerprint,
    personCode,
    personName: text(row.PersonName) ?? personCode,
    settleNo: text(row.SettleNo),
    handCardCode: text(row.HandCardCode),
    itemName: text(row.ItemName),
    clockType: text(row.ClockType),
    count: number(row.Count),
    turnover: number(row.Turnover),
    comm: number(row.Comm),
    ctime,
    settleTime,
    bizDate: extractBizDate(settleTime, timeZone, now, cutoffLocalTime),
    rawJson: JSON.stringify(row),
  };
}

export function normalizeTechMarketRow(
  row: Record<string, unknown>,
  orgId: string,
  timeZone: string,
  now: Date,
  cutoffLocalTime = "03:00",
): TechMarketRecord | null {
  const settleTime = text(row.SettleTime) ?? text(row.CTime);
  if (!settleTime) {
    return null;
  }
  const marketId = text(row.Id);
  const recordKey =
    marketId ??
    md5(
      [
        orgId,
        text(row.PersonCode) ?? "",
        text(row.ItemId) ?? "",
        settleTime,
        number(row.AfterDisc),
        number(row.Commission),
      ].join("|"),
    );

  return {
    orgId,
    recordKey,
    marketId,
    settleNo: text(row.SettleNo),
    handCardCode: text(row.HandCardCode),
    roomCode: text(row.RoomCode),
    personCode: text(row.PersonCode),
    personName: text(row.PersonName),
    itemId: text(row.ItemId),
    itemName: text(row.ItemName),
    itemTypeName: text(row.ItemTypeName),
    itemCategory: text(row.ItemCategory) ? number(row.ItemCategory) : undefined,
    salesCode: text(row.SalesCode),
    salesName: text(row.SalesName),
    count: number(row.Count),
    afterDisc: number(row.AfterDisc ?? row.Price),
    commission: number(row.Commission),
    settleTime,
    bizDate: extractBizDate(settleTime, timeZone, now, cutoffLocalTime),
    rawJson: JSON.stringify(row),
  };
}

export function normalizeTechCommissionRow(
  row: Record<string, unknown>,
  orgId: string,
  bizDate: string,
): TechCommissionSnapshotRecord | null {
  const itemId = text(row.ItemId);
  if (!itemId) {
    return null;
  }
  const ruleHash = md5(JSON.stringify(row.PCBaseList ?? []));
  return {
    bizDate,
    orgId,
    itemId,
    itemName: text(row.ItemName),
    ruleHash,
    rawJson: JSON.stringify(row),
  };
}
