import { describe, expect, it } from "vitest";
import {
  buildReconstructedMemberSnapshotsByDate,
  streamReconstructedMemberSnapshotsByDate,
} from "./customer-history-backfill.js";
import type {
  ConsumeBillRecord,
  MemberCardCurrentRecord,
  MemberCurrentRecord,
  RechargeBillRecord,
} from "./types.js";

const member: MemberCurrentRecord = {
  orgId: "1001",
  memberId: "member-001",
  name: "王先生",
  phone: "13800000000",
  storedAmount: 1062,
  consumeAmount: 438,
  createdTime: "2026-03-29 15:00:00",
  lastConsumeTime: "2026-04-02 21:00:00",
  silentDays: 0,
  rawJson: JSON.stringify({
    Id: "member-001",
    Name: "王先生",
    StoredAmount: 1062,
    ConsumeAmount: 438,
    CTime: "2026-03-29 15:00:00",
    LastConsumeTime: "2026-04-02 21:00:00",
  }),
};

const cards: MemberCardCurrentRecord[] = [
  {
    orgId: "1001",
    memberId: "member-001",
    cardId: "card-001",
    cardNo: "YW001",
    rawJson: "{}",
  },
];

const consumeBills: ConsumeBillRecord[] = [
  {
    orgId: "1001",
    settleId: "settle-001",
    settleNo: "NO-001",
    payAmount: 238,
    consumeAmount: 238,
    discountAmount: 0,
    antiFlag: false,
    optTime: "2026-03-30 21:00:00",
    bizDate: "2026-03-30",
    rawJson: JSON.stringify({
      Payments: [{ Name: "会员", Amount: 238, PaymentType: 3 }],
      Infos: ["王先生 (金悦卡) [YW001],消费238.00元(积分+0);"],
    }),
  },
  {
    orgId: "1001",
    settleId: "settle-002",
    settleNo: "NO-002",
    payAmount: 200,
    consumeAmount: 200,
    discountAmount: 0,
    antiFlag: false,
    optTime: "2026-04-02 21:00:00",
    bizDate: "2026-04-02",
    rawJson: JSON.stringify({
      Payments: [{ Name: "会员", Amount: 200, PaymentType: 3 }],
      Infos: ["王先生 (金悦卡) [YW001],消费200.00元(积分+0);"],
    }),
  },
];

const rechargeBills: RechargeBillRecord[] = [
  {
    orgId: "1001",
    rechargeId: "recharge-001",
    realityAmount: 1000,
    totalAmount: 1000,
    donateAmount: 0,
    antiFlag: false,
    optTime: "2026-03-29 15:00:00",
    bizDate: "2026-03-29",
    rawJson: JSON.stringify({
      CardId: "card-001",
      CardNo: "YW001",
      MemberName: "王先生",
      MemberPhone: "13800000000",
      Total: 1000,
    }),
  },
  {
    orgId: "1001",
    rechargeId: "recharge-002",
    realityAmount: 500,
    totalAmount: 500,
    donateAmount: 0,
    antiFlag: false,
    optTime: "2026-04-01 12:00:00",
    bizDate: "2026-04-01",
    rawJson: JSON.stringify({
      CardId: "card-001",
      CardNo: "YW001",
      MemberName: "王先生",
      MemberPhone: "13800000000",
      Total: 500,
    }),
  },
];

describe("buildReconstructedMemberSnapshotsByDate", () => {
  it("reconstructs daily stored balance, cumulative consume, and silent days from current member state", () => {
    const snapshots = buildReconstructedMemberSnapshotsByDate({
      startBizDate: "2026-03-29",
      endBizDate: "2026-04-02",
      currentMembers: [member],
      currentMemberCards: cards,
      consumeBills,
      rechargeBills,
    });

    expect(snapshots.get("2026-03-29")).toEqual([
      expect.objectContaining({
        memberId: "member-001",
        storedAmount: 1000,
        consumeAmount: 0,
        silentDays: 0,
      }),
    ]);
    expect(snapshots.get("2026-03-30")).toEqual([
      expect.objectContaining({
        memberId: "member-001",
        storedAmount: 762,
        consumeAmount: 238,
        lastConsumeTime: "2026-03-30 21:00:00",
        silentDays: 0,
      }),
    ]);
    expect(snapshots.get("2026-03-31")).toEqual([
      expect.objectContaining({
        memberId: "member-001",
        storedAmount: 762,
        consumeAmount: 238,
        lastConsumeTime: "2026-03-30 21:00:00",
        silentDays: 1,
      }),
    ]);
    expect(snapshots.get("2026-04-01")).toEqual([
      expect.objectContaining({
        memberId: "member-001",
        storedAmount: 1262,
        consumeAmount: 238,
        lastConsumeTime: "2026-03-30 21:00:00",
        silentDays: 2,
      }),
    ]);
    expect(snapshots.get("2026-04-02")).toEqual([
      expect.objectContaining({
        memberId: "member-001",
        storedAmount: 1062,
        consumeAmount: 438,
        lastConsumeTime: "2026-04-02 21:00:00",
        silentDays: 0,
      }),
    ]);
  });

  it("streams reconstructed snapshots one biz date at a time with the same result", async () => {
    const streamed = new Map<string, MemberCurrentRecord[]>();

    await streamReconstructedMemberSnapshotsByDate({
      startBizDate: "2026-03-29",
      endBizDate: "2026-04-02",
      currentMembers: [member],
      currentMemberCards: cards,
      consumeBills,
      rechargeBills,
      onDate: (bizDate, rows) => {
        streamed.set(bizDate, rows);
      },
    });

    expect(streamed).toEqual(
      buildReconstructedMemberSnapshotsByDate({
        startBizDate: "2026-03-29",
        endBizDate: "2026-04-02",
        currentMembers: [member],
        currentMemberCards: cards,
        consumeBills,
        rechargeBills,
      }),
    );
  });
});
