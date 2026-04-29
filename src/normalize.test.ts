import { describe, expect, it } from "vitest";
import {
  normalizeConsumeBillRow,
  normalizeMemberCardRows,
  normalizeMemberRow,
  normalizeRechargeBillRow,
  normalizeTechCommissionRow,
  normalizeTechCurrentRow,
  normalizeTechMarketRow,
  normalizeTechUpClockRow,
  normalizeUserTradeRow,
} from "./normalize.js";

const NOW = new Date("2026-03-31T03:10:00+08:00");
const ORG_ID = "627150985244677";
const TIME_ZONE = "Asia/Shanghai";

describe("Hetang API normalization", () => {
  it("normalizes 1.1 member rows, falls back to Assets, and preserves raw-only fields", () => {
    const row = {
      Id: "M-001",
      Name: "会员甲",
      Phone: "13800000000",
      Assets: 880,
      ConsumeAmount: 1260,
      CTime: "2026-03-12 12:00:00",
      LastConsumeTime: "2026-03-30 23:30:00",
      SilentDays: 7,
      From: 2,
      Labels: ["高频", "女宾"],
      Coupons: [{ Name: "30元券", IsUsed: false }],
      OrgName: "义乌店",
    };

    const normalized = normalizeMemberRow(row, ORG_ID);

    expect(normalized).toMatchObject({
      orgId: ORG_ID,
      memberId: "M-001",
      name: "会员甲",
      phone: "13800000000",
      storedAmount: 880,
      consumeAmount: 1260,
      createdTime: "2026-03-12 12:00:00",
      lastConsumeTime: "2026-03-30 23:30:00",
      silentDays: 7,
      rawStoreName: "义乌店",
    });
    expect(JSON.parse(normalized?.rawJson ?? "{}")).toMatchObject({
      From: 2,
      Labels: ["高频", "女宾"],
      Coupons: [{ Name: "30元券", IsUsed: false }],
    });
  });

  it("prefers summed stored-card balances over top-level StoredAmount when cards are present", () => {
    const row = {
      Id: "M-002",
      Name: "会员乙",
      StoredAmount: 6400,
      ConsumeAmount: 3715,
      Storeds: [
        { Id: "CARD-001", OrgId: ORG_ID, Balance: 2285, RealityBalance: 2285, DonateBalance: 0 },
        { Id: "CARD-002", OrgId: ORG_ID, Balance: 1200, RealityBalance: 0, DonateBalance: 1200 },
      ],
    };

    const normalized = normalizeMemberRow(row, ORG_ID);

    expect(normalized?.storedAmount).toBe(3485);
  });

  it("normalizes 1.1 member-card rows only for the requested store", () => {
    const cards = normalizeMemberCardRows(
      {
        Id: "M-001",
        Storeds: [
          { Id: "CARD-001", CardNo: "YW001", OrgId: ORG_ID, Balance: 500 },
          { Id: "CARD-OTHER", CardNo: "OTHER", OrgId: "another-store", Balance: 900 },
          { CardNo: "MISSING-ID", OrgId: ORG_ID },
        ],
      },
      ORG_ID,
    );

    expect(cards).toEqual([
      expect.objectContaining({
        orgId: ORG_ID,
        memberId: "M-001",
        cardId: "CARD-001",
        cardNo: "YW001",
      }),
    ]);
    expect(JSON.parse(cards[0]?.rawJson ?? "{}")).toMatchObject({
      Balance: 500,
    });
  });

  it("normalizes 1.2 consume rows, attributes overnight business dates, and keeps payment detail raw fields", () => {
    const row = {
      SettleId: "SETTLE-001",
      SettleNo: "NO-001",
      Pay: 398,
      Consume: 428,
      DiscountAmount: 30,
      IsAnti: 0,
      OptTime: "2026-03-31 02:45:00",
      CCode: "C-001",
      CallNumber: "A08",
      Payments: [
        { Name: "会员", Amount: 238, PaymentType: 3 },
        { Name: "美团", Amount: 160, PaymentType: -1 },
      ],
      Infos: [{ ItemName: "足疗", Price: 238 }],
    };

    const normalized = normalizeConsumeBillRow(row, ORG_ID, TIME_ZONE, NOW);

    expect(normalized).toMatchObject({
      orgId: ORG_ID,
      settleId: "SETTLE-001",
      settleNo: "NO-001",
      payAmount: 398,
      consumeAmount: 428,
      discountAmount: 30,
      antiFlag: false,
      optTime: "2026-03-31 02:45:00",
      bizDate: "2026-03-30",
    });
    expect(JSON.parse(normalized?.rawJson ?? "{}")).toMatchObject({
      CCode: "C-001",
      CallNumber: "A08",
      Payments: [
        { Name: "会员", Amount: 238, PaymentType: 3 },
        { Name: "美团", Amount: 160, PaymentType: -1 },
      ],
    });
  });

  it("treats records after 03:00 as the current operational day by default", () => {
    const normalized = normalizeConsumeBillRow(
      {
        SettleId: "SETTLE-003",
        Pay: 128,
        Consume: 128,
        DiscountAmount: 0,
        IsAnti: 0,
        OptTime: "2026-03-31 03:05:00",
      },
      ORG_ID,
      TIME_ZONE,
      NOW,
    );

    expect(normalized?.bizDate).toBe("2026-03-31");
  });

  it("normalizes 1.3 recharge rows and preserves card-type and payment detail fields in rawJson", () => {
    const row = {
      Id: "RECHARGE-001",
      Reality: 1000,
      Total: 1200,
      Donate: 200,
      Type: 1,
      CardTypeName: "储值卡",
      Payments: [{ Name: "微信", Amount: 1000, PaymentType: 4 }],
      OptTime: "2026-03-30 11:20:00",
      IsAnti: 0,
    };

    const normalized = normalizeRechargeBillRow(row, ORG_ID, TIME_ZONE, NOW);

    expect(normalized).toMatchObject({
      orgId: ORG_ID,
      rechargeId: "RECHARGE-001",
      realityAmount: 1000,
      totalAmount: 1200,
      donateAmount: 200,
      antiFlag: false,
      optTime: "2026-03-30 11:20:00",
      bizDate: "2026-03-30",
    });
    expect(JSON.parse(normalized?.rawJson ?? "{}")).toMatchObject({
      Type: 1,
      CardTypeName: "储值卡",
      Payments: [{ Name: "微信", Amount: 1000, PaymentType: 4 }],
    });
  });

  it("normalizes 1.4 user-trade rows and preserves ending balance fields for later audit", () => {
    const row = {
      TradeNo: "TRADE-001",
      OptTime: "2026-03-30 23:50:00",
      CardOptType: "consume",
      ChangeBalance: -238,
      ChangeReality: 0,
      ChangeDonate: 0,
      ChangeIntegral: 10,
      PaymentType: "balance",
      EndBalance: 762,
      EndReality: 700,
      EndDonate: 62,
      EndIntegral: 110,
      AntiTime: "2026-03-31 00:30:00",
      IsAnti: 0,
      OrgName: "义乌店",
    };

    const normalized = normalizeUserTradeRow(row, ORG_ID, TIME_ZONE, NOW);

    expect(normalized).toMatchObject({
      orgId: ORG_ID,
      tradeNo: "TRADE-001",
      optTime: "2026-03-30 23:50:00",
      bizDate: "2026-03-30",
      cardOptType: "consume",
      changeBalance: -238,
      changeReality: 0,
      changeDonate: 0,
      changeIntegral: 10,
      paymentType: "balance",
      antiFlag: false,
    });
    expect(normalized?.rowFingerprint).toMatch(/^[0-9a-f]{32}$/u);
    expect(JSON.parse(normalized?.rawJson ?? "{}")).toMatchObject({
      EndBalance: 762,
      EndReality: 700,
      EndDonate: 62,
      EndIntegral: 110,
      AntiTime: "2026-03-31 00:30:00",
    });
  });

  it("normalizes 1.5 technician current rows and keeps staffing metadata in rawJson", () => {
    const row = {
      Code: "T-001",
      Name: "技师甲",
      IsWork: 1,
      IsJob: 1,
      PointClockNum: 6,
      WheelClockNum: 12,
      BaseWages: 4200,
      PersonState: 2,
      PersonStateName: "上钟中",
      ClassId: "A",
      PostType: 3,
      ItemList: [{ ItemId: "ITEM-001", ItemName: "足疗" }],
      OrgName: "义乌店",
    };

    const normalized = normalizeTechCurrentRow(row, ORG_ID);

    expect(normalized).toMatchObject({
      orgId: ORG_ID,
      techCode: "T-001",
      techName: "技师甲",
      isWork: true,
      isJob: true,
      pointClockNum: 6,
      wheelClockNum: 12,
      baseWages: 4200,
      rawStoreName: "义乌店",
    });
    expect(JSON.parse(normalized?.rawJson ?? "{}")).toMatchObject({
      PersonState: 2,
      PersonStateName: "上钟中",
      ClassId: "A",
      PostType: 3,
      ItemList: [{ ItemId: "ITEM-001", ItemName: "足疗" }],
    });
  });

  it("normalizes 1.6 technician clock rows and keeps add-clock and duration detail raw fields", () => {
    const row = {
      PersonCode: "T-001",
      PersonName: "技师甲",
      SettleNo: "NO-001",
      HandCardCode: "HC-001",
      ItemName: "足疗",
      ClockType: 2,
      Count: 2,
      Turnover: 398,
      Comm: 120,
      Income: 278,
      BasicComm: 90,
      Duration: 70,
      AddClockType: 1,
      AddClockDesc: "加钟20分钟",
      AddClockTypeComm: 30,
      WaitTime: 5,
      RoomCode: "A08",
      CTime: "2026-03-31 01:20:00",
      SettleTime: "2026-03-31 02:40:00",
    };

    const normalized = normalizeTechUpClockRow(row, ORG_ID, TIME_ZONE, NOW);

    expect(normalized).toMatchObject({
      orgId: ORG_ID,
      personCode: "T-001",
      personName: "技师甲",
      settleNo: "NO-001",
      handCardCode: "HC-001",
      itemName: "足疗",
      clockType: "2",
      count: 2,
      turnover: 398,
      comm: 120,
      ctime: "2026-03-31 01:20:00",
      settleTime: "2026-03-31 02:40:00",
      bizDate: "2026-03-30",
    });
    expect(JSON.parse(normalized?.rawJson ?? "{}")).toMatchObject({
      AddClockType: 1,
      AddClockDesc: "加钟20分钟",
      AddClockTypeComm: 30,
      Duration: 70,
      Income: 278,
      WaitTime: 5,
      RoomCode: "A08",
    });
  });

  it("normalizes 1.7 technician market rows, synthesizes record keys, and keeps sales metadata raw fields", () => {
    const row = {
      SettleNo: "XF2603220000",
      HandCardCode: "A08",
      RoomCode: "V02",
      PersonCode: "T-001",
      PersonName: "技师甲",
      ItemId: "ITEM-101",
      ItemName: "精油",
      ItemTypeName: "商品",
      ItemCategory: 3,
      Count: 2,
      AfterDisc: 198,
      Commission: 36,
      IsDonate: 1,
      SalesCode: "S-001",
      SalesName: "前台甲",
      SettleTime: "2026-03-30 20:30:00",
    };

    const normalized = normalizeTechMarketRow(row, ORG_ID, TIME_ZONE, NOW);

    expect(normalized).toMatchObject({
      orgId: ORG_ID,
      settleNo: "XF2603220000",
      handCardCode: "A08",
      roomCode: "V02",
      personCode: "T-001",
      personName: "技师甲",
      itemId: "ITEM-101",
      itemName: "精油",
      itemTypeName: "商品",
      itemCategory: 3,
      salesCode: "S-001",
      salesName: "前台甲",
      count: 2,
      afterDisc: 198,
      commission: 36,
      settleTime: "2026-03-30 20:30:00",
      bizDate: "2026-03-30",
    });
    expect(normalized?.recordKey).toMatch(/^[0-9a-f]{32}$/u);
    expect(JSON.parse(normalized?.rawJson ?? "{}")).toMatchObject({
      ItemTypeName: "商品",
      ItemCategory: 3,
      IsDonate: 1,
      SalesCode: "S-001",
      SalesName: "前台甲",
    });
  });

  it("normalizes 1.8 technician commission rows and preserves full commission-rule detail", () => {
    const row = {
      ItemId: "ITEM-101",
      ItemName: "足疗",
      PCBaseList: [
        { Channel: "wheel", Ratio: 0.32 },
        { Channel: "appoint", Ratio: 0.38 },
      ],
    };

    const normalized = normalizeTechCommissionRow(row, ORG_ID, "2026-03-30");

    expect(normalized).toMatchObject({
      bizDate: "2026-03-30",
      orgId: ORG_ID,
      itemId: "ITEM-101",
      itemName: "足疗",
    });
    expect(normalized?.ruleHash).toMatch(/^[0-9a-f]{32}$/u);
    expect(JSON.parse(normalized?.rawJson ?? "{}")).toMatchObject({
      PCBaseList: [
        { Channel: "wheel", Ratio: 0.32 },
        { Channel: "appoint", Ratio: 0.38 },
      ],
    });
  });
});
