import { describe, expect, it, vi } from "vitest";
import type {
  ConsumeBillRecord,
  MemberCardCurrentRecord,
  MemberCurrentRecord,
  RechargeBillRecord,
  UserTradeRecord,
} from "./types.js";
import {
  buildLegacyConsumeRows,
  buildLegacyCurrentRows,
  buildLegacyIdentityContext,
  buildLegacySnapshotRows,
  buildLegacyUserTradeRows,
  importLegacyYingbinData,
  listUncoveredBizDateRanges,
  mapLegacyRechargeRows,
  type LegacyConsumeItemRow,
  type LegacyCurrentCardRow,
  type LegacyRechargeRow,
  type LegacySettlementDetailRow,
  type LegacySnapshotCardRow,
} from "./legacy-mysql-import.js";

const ORG_ID = "627149864218629";
const STORE_NAME = "荷塘悦色迎宾店";

function parseRaw(rawJson: string): Record<string, unknown> {
  return JSON.parse(rawJson) as Record<string, unknown>;
}

describe("legacy MySQL import mapping", () => {
  it("builds member current rows from legacy card rows and aligns to existing live member identities", () => {
    const identityContext = buildLegacyIdentityContext({
      currentMembers: [
        {
          orgId: ORG_ID,
          memberId: "member-live-001",
          name: "刘女士",
          phone: "17550895520",
          storedAmount: 1200,
          consumeAmount: 2600,
          createdTime: "2025-01-10 10:00:00",
          lastConsumeTime: "2026-04-09 21:30:00",
          silentDays: 0,
          rawJson: JSON.stringify({ Id: "member-live-001", Phone: "17550895520" }),
        },
      ],
      currentMemberCards: [
        {
          orgId: ORG_ID,
          memberId: "member-live-001",
          cardId: "live-card-001",
          cardNo: "YB001",
          rawJson: JSON.stringify({ Id: "live-card-001", CardNo: "YB001" }),
        },
      ],
    });

    const rows: LegacyCurrentCardRow[] = [
      {
        ID: "legacy-card-001",
        userid: "legacy-user-001",
        number: "YB001",
        balance: 800,
        expense: 1200,
        mobile: "17550895520",
        opentime: "2024-01-01 10:00:00",
        LASTUSERTIME: "2025-01-01 20:30:00",
        MCARD_NAME: "刘女士",
        MCARD_TYPENAME: "金悦卡",
      },
      {
        ID: "legacy-card-002",
        userid: "legacy-user-001",
        number: "YB002",
        balance: 200,
        expense: 300,
        mobile: "17550895520",
        opentime: "2024-02-01 10:00:00",
        LASTUSERTIME: "2025-01-01 20:40:00",
        MCARD_NAME: "刘女士",
        MCARD_TYPENAME: "尊享卡",
      },
    ];

    const { members, cards } = buildLegacyCurrentRows({
      orgId: ORG_ID,
      storeName: STORE_NAME,
      rows,
      identityContext,
    });

    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({
      orgId: ORG_ID,
      memberId: "member-live-001",
      name: "刘女士",
      phone: "17550895520",
      storedAmount: 1000,
      consumeAmount: 1500,
      createdTime: "2024-01-01 10:00:00",
      lastConsumeTime: "2025-01-01 20:40:00",
      rawStoreName: STORE_NAME,
    } satisfies Partial<MemberCurrentRecord>);
    expect(parseRaw(members[0]!.rawJson)).toMatchObject({
      Id: "member-live-001",
      Name: "刘女士",
      Phone: "17550895520",
      OrgName: STORE_NAME,
      StoredAmount: 1000,
      ConsumeAmount: 1500,
      Storeds: [
        expect.objectContaining({ Id: "legacy-card-001", CardNo: "YB001", OrgId: ORG_ID, Balance: 800 }),
        expect.objectContaining({ Id: "legacy-card-002", CardNo: "YB002", OrgId: ORG_ID, Balance: 200 }),
      ],
    });

    expect(cards).toEqual([
      expect.objectContaining({
        orgId: ORG_ID,
        memberId: "member-live-001",
        cardId: "legacy-card-001",
        cardNo: "YB001",
      }),
      expect.objectContaining({
        orgId: ORG_ID,
        memberId: "member-live-001",
        cardId: "legacy-card-002",
        cardNo: "YB002",
      }),
    ] satisfies Array<Partial<MemberCardCurrentRecord>>);
  });

  it("builds daily member snapshots from backup rows, deduping same-card same-day backups by the latest backup time", () => {
    const rows: LegacySnapshotCardRow[] = [
      {
        ID: "legacy-card-001",
        userid: "legacy-user-001",
        number: "YB001",
        balance: 300,
        expense: 900,
        mobile: "13800000001",
        opentime: "2024-01-01 10:00:00",
        LASTUSERTIME: "2025-01-01 20:10:00",
        MCARD_NAME: "王女士",
        MCARD_TYPENAME: "金悦卡",
        BAKDATETIME: "2025-01-02 00:20:00",
      },
      {
        ID: "legacy-card-001",
        userid: "legacy-user-001",
        number: "YB001",
        balance: 250,
        expense: 950,
        mobile: "13800000001",
        opentime: "2024-01-01 10:00:00",
        LASTUSERTIME: "2025-01-01 20:30:00",
        MCARD_NAME: "王女士",
        MCARD_TYPENAME: "金悦卡",
        BAKDATETIME: "2025-01-02 02:40:00",
      },
      {
        ID: "legacy-card-002",
        userid: "legacy-user-001",
        number: "YB002",
        balance: 100,
        expense: 150,
        mobile: "13800000001",
        opentime: "2024-02-01 10:00:00",
        LASTUSERTIME: "2025-01-01 19:10:00",
        MCARD_NAME: "王女士",
        MCARD_TYPENAME: "尊享卡",
        BAKDATETIME: "2025-01-02 00:10:00",
      },
    ];

    const snapshots = buildLegacySnapshotRows({
      orgId: ORG_ID,
      storeName: STORE_NAME,
      rows,
      identityContext: buildLegacyIdentityContext({
        currentMembers: [],
        currentMemberCards: [],
      }),
    });

    const memberSnapshots = snapshots.memberSnapshotsByBizDate.get("2025-01-01");
    const cardSnapshots = snapshots.cardSnapshotsByBizDate.get("2025-01-01");

    expect(memberSnapshots).toEqual([
      expect.objectContaining({
        orgId: ORG_ID,
        name: "王女士",
        phone: "13800000001",
        storedAmount: 350,
        consumeAmount: 1100,
        createdTime: "2024-01-01 10:00:00",
        lastConsumeTime: "2025-01-01 20:30:00",
      }),
    ] satisfies Array<Partial<MemberCurrentRecord>>);
    expect(parseRaw(memberSnapshots?.[0]?.rawJson ?? "{}")).toMatchObject({
      StoredAmount: 350,
      ConsumeAmount: 1100,
      Storeds: [
        expect.objectContaining({ CardNo: "YB001", Balance: 250 }),
        expect.objectContaining({ CardNo: "YB002", Balance: 100 }),
      ],
    });
    expect(cardSnapshots).toEqual([
      expect.objectContaining({ cardNo: "YB001" }),
      expect.objectContaining({ cardNo: "YB002" }),
    ]);
  });

  it("maps legacy recharge rows to recharge facts with compatible raw identity fields", () => {
    const rows: LegacyRechargeRow[] = [
      {
        exe_member_recharge_id: "recharge-001",
        MCARDID: "legacy-card-001",
        NUMBER: "YB001",
        MONEY: 500,
        GIFTMONEY: 50,
        TOTALMONEY: 550,
        OPTIME: "2025-01-02 02:50:00",
        CANCELFLAG: 1,
        MCARD_NAME: "刘女士",
        MCARD_PHONE: "17550895520",
        MCARD_TYPENAME: "金悦卡",
        RES_RECHARGETYPE_ID: 2,
      },
    ];

    const mapped = mapLegacyRechargeRows({
      orgId: ORG_ID,
      rows,
      rechargeTypeNameById: new Map([[2, "会员充值"]]),
    });

    expect(mapped).toEqual([
      expect.objectContaining({
        orgId: ORG_ID,
        rechargeId: "recharge-001",
        realityAmount: 500,
        totalAmount: 550,
        donateAmount: 50,
        antiFlag: true,
        optTime: "2025-01-02 02:50:00",
        bizDate: "2025-01-01",
      }),
    ] satisfies Array<Partial<RechargeBillRecord>>);
    expect(parseRaw(mapped[0]!.rawJson)).toMatchObject({
      CardId: "legacy-card-001",
      CardNo: "YB001",
      MemberName: "刘女士",
      MemberPhone: "17550895520",
      CardTypeName: "金悦卡",
      RechargeTypeName: "会员充值",
      Type: 2,
    });
  });

  it("builds consume facts from legacy consume and settlement rows with payment and customer details preserved", () => {
    const consumeRows: LegacyConsumeItemRow[] = [
      {
        EXE_CONSUMERITEMS_ID: "consume-001",
        EXE_SETTLEMENT_SHEET_SN: "XF202501010035",
        ORDERPERSONNAME: "刘女士",
        CONSUM_MONEY: 1225,
        DISCOUNT_MONEY: 0,
        PAY_MONEY: 1225,
        CANCELFLAG: 0,
        SETTLEMENT_TIME: "2025-01-02 02:30:00",
        ROOMCODE: "V01",
        SETTLEMENT_ID: "803",
      },
    ];
    const settlementRows: LegacySettlementDetailRow[] = [
      {
        EXE_SETTLEMENT_DETAIL_ID: 1,
        EXE_CONSUMERITEMS_ID: "consume-001",
        RES_SETTLEMENT_TYPE_ID: 3,
        MCARD_ID: "YB001",
        USEMONEY: 300,
        MCARD_NAME: "刘女士",
        MCARD_PHONE: "17550895520",
        MCARD_TYPENAME: "金悦卡",
        SETTLETIME: "2025-01-02 02:30:00",
        xfsc: 280,
        xfzs: 20,
      },
      {
        EXE_SETTLEMENT_DETAIL_ID: 2,
        EXE_CONSUMERITEMS_ID: "consume-001",
        RES_SETTLEMENT_TYPE_ID: 4,
        MCARD_ID: "",
        USEMONEY: 925,
        MCARD_NAME: "",
        MCARD_PHONE: "",
        MCARD_TYPENAME: "",
        SETTLETIME: "2025-01-02 02:30:00",
        xfsc: 0,
        xfzs: 0,
      },
    ];

    const mapped = buildLegacyConsumeRows({
      orgId: ORG_ID,
      consumeRows,
      settlementRows,
      settlementTypeNameById: new Map([
        [3, "会员"],
        [4, "微信"],
      ]),
    });

    expect(mapped).toEqual([
      expect.objectContaining({
        orgId: ORG_ID,
        settleId: "consume-001",
        settleNo: "XF202501010035",
        payAmount: 1225,
        consumeAmount: 1225,
        discountAmount: 0,
        antiFlag: false,
        optTime: "2025-01-02 02:30:00",
        bizDate: "2025-01-01",
      }),
    ] satisfies Array<Partial<ConsumeBillRecord>>);

    expect(parseRaw(mapped[0]!.rawJson)).toMatchObject({
      SettleId: "consume-001",
      SettleNo: "XF202501010035",
      CardNo: "YB001",
      MemberPhone: "17550895520",
      MemberName: "刘女士",
      RoomCode: "V01",
      Infos: ["刘女士 (金悦卡) [YB001],消费1225.00元;"],
      Payments: [
        { Name: "会员", Amount: 300, PaymentType: 3 },
        { Name: "微信", Amount: 925, PaymentType: 4 },
      ],
    });
  });

  it("extracts member-balance user trades from legacy settlement detail rows", () => {
    const mapped = buildLegacyUserTradeRows({
      orgId: ORG_ID,
      rows: [
        {
          EXE_SETTLEMENT_DETAIL_ID: 1,
          EXE_CONSUMERITEMS_ID: "consume-001",
          RES_SETTLEMENT_TYPE_ID: 3,
          MCARD_ID: "YB001",
          USEMONEY: 300,
          MCARD_NAME: "刘女士",
          MCARD_PHONE: "17550895520",
          MCARD_TYPENAME: "金悦卡",
          SETTLETIME: "2025-01-02 02:30:00",
          xfsc: 280,
          xfzs: 20,
        },
        {
          EXE_SETTLEMENT_DETAIL_ID: 2,
          EXE_CONSUMERITEMS_ID: "consume-001",
          RES_SETTLEMENT_TYPE_ID: 4,
          MCARD_ID: "",
          USEMONEY: 925,
          MCARD_NAME: "",
          MCARD_PHONE: "",
          MCARD_TYPENAME: "",
          SETTLETIME: "2025-01-02 02:30:00",
          xfsc: 0,
          xfzs: 0,
        },
      ],
    });

    expect(mapped).toEqual([
      expect.objectContaining({
        orgId: ORG_ID,
        tradeNo: "legacy-settle:consume-001:1",
        cardOptType: "legacy_consume_settle",
        changeBalance: -300,
        changeReality: -280,
        changeDonate: -20,
        changeIntegral: 0,
        paymentType: "member-balance",
        antiFlag: false,
        optTime: "2025-01-02 02:30:00",
        bizDate: "2025-01-01",
      }),
    ] satisfies Array<Partial<UserTradeRecord>>);
    expect(parseRaw(mapped[0]!.rawJson)).toMatchObject({
      CardNo: "YB001",
      MemberName: "刘女士",
      MemberPhone: "17550895520",
      CardTypeName: "金悦卡",
      SourceConsumeId: "consume-001",
    });
  });
});

describe("importLegacyYingbinData", () => {
  it("splits uncovered biz dates into contiguous rebuild ranges", () => {
    expect(
      listUncoveredBizDateRanges({
        startBizDate: "2025-01-01",
        endBizDate: "2025-01-06",
        coveredBizDates: new Set(["2025-01-01", "2025-01-03", "2025-01-04", "2025-01-06"]),
      }),
    ).toEqual([
      { startBizDate: "2025-01-02", endBizDate: "2025-01-02" },
      { startBizDate: "2025-01-05", endBizDate: "2025-01-05" },
    ]);
  });

  it("writes current/history/facts in batches and refreshes analytics only once at the end", async () => {
    const upsertMemberCurrent = vi.fn().mockResolvedValue(undefined);
    const upsertMemberCards = vi.fn().mockResolvedValue(undefined);
    const replaceMemberDailySnapshots = vi.fn().mockResolvedValue(undefined);
    const replaceMemberCardDailySnapshots = vi.fn().mockResolvedValue(undefined);
    const upsertRechargeBills = vi.fn().mockResolvedValue(undefined);
    const upsertConsumeBills = vi.fn().mockResolvedValue(undefined);
    const upsertUserTrades = vi.fn().mockResolvedValue(undefined);
    const forceRebuildAnalyticsViews = vi.fn().mockResolvedValue(undefined);

    const store = {
      listCurrentMembers: vi.fn().mockResolvedValue([
        {
          orgId: ORG_ID,
          memberId: "member-live-001",
          name: "刘女士",
          phone: "17550895520",
          storedAmount: 500,
          consumeAmount: 200,
          createdTime: "2025-01-01 10:00:00",
          lastConsumeTime: "2025-01-01 21:00:00",
          silentDays: 0,
          rawJson: JSON.stringify({ Id: "member-live-001", Phone: "17550895520" }),
        },
      ] satisfies MemberCurrentRecord[]),
      listCurrentMemberCards: vi.fn().mockResolvedValue([
        {
          orgId: ORG_ID,
          memberId: "member-live-001",
          cardId: "live-card-001",
          cardNo: "YB001",
          rawJson: JSON.stringify({ Id: "live-card-001", CardNo: "YB001" }),
        },
      ] satisfies MemberCardCurrentRecord[]),
      upsertMemberCurrent,
      upsertMemberCards,
      replaceMemberDailySnapshots,
      replaceMemberCardDailySnapshots,
      upsertRechargeBills,
      upsertConsumeBills,
      upsertUserTrades,
      forceRebuildAnalyticsViews,
    };

    await importLegacyYingbinData({
      orgId: ORG_ID,
      storeName: STORE_NAME,
      store: store as never,
      currentCardRows: [
        {
          ID: "legacy-card-001",
          userid: "legacy-user-001",
          number: "YB001",
          balance: 800,
          expense: 1200,
          mobile: "17550895520",
          opentime: "2024-01-01 10:00:00",
          LASTUSERTIME: "2025-01-01 20:30:00",
          MCARD_NAME: "刘女士",
          MCARD_TYPENAME: "金悦卡",
        },
        {
          ID: "legacy-card-999",
          userid: "legacy-user-999",
          number: "YB999",
          balance: 120,
          expense: 80,
          mobile: "13900000000",
          opentime: "2024-02-01 10:00:00",
          LASTUSERTIME: "2025-01-01 21:30:00",
          MCARD_NAME: "新会员",
          MCARD_TYPENAME: "普卡",
        },
      ],
      snapshotCardRows: [
        {
          ID: "legacy-card-999",
          userid: "legacy-user-999",
          number: "YB999",
          balance: 120,
          expense: 80,
          mobile: "13900000000",
          opentime: "2024-02-01 10:00:00",
          LASTUSERTIME: "2025-01-01 21:30:00",
          MCARD_NAME: "新会员",
          MCARD_TYPENAME: "普卡",
          BAKDATETIME: "2025-01-02 01:30:00",
        },
      ],
      rechargeRows: [
        {
          exe_member_recharge_id: "recharge-001",
          MCARDID: "legacy-card-999",
          NUMBER: "YB999",
          MONEY: 100,
          GIFTMONEY: 20,
          TOTALMONEY: 120,
          OPTIME: "2025-01-02 09:00:00",
          CANCELFLAG: 0,
          MCARD_NAME: "新会员",
          MCARD_PHONE: "13900000000",
          MCARD_TYPENAME: "普卡",
          RES_RECHARGETYPE_ID: 2,
        },
      ],
      consumeRows: [
        {
          EXE_CONSUMERITEMS_ID: "consume-001",
          EXE_SETTLEMENT_SHEET_SN: "XF202501010035",
          ORDERPERSONNAME: "新会员",
          CONSUM_MONEY: 120,
          DISCOUNT_MONEY: 0,
          PAY_MONEY: 120,
          CANCELFLAG: 0,
          SETTLEMENT_TIME: "2025-01-02 10:00:00",
          ROOMCODE: "V01",
          SETTLEMENT_ID: "803",
        },
      ],
      settlementRows: [
        {
          EXE_SETTLEMENT_DETAIL_ID: 1,
          EXE_CONSUMERITEMS_ID: "consume-001",
          RES_SETTLEMENT_TYPE_ID: 3,
          MCARD_ID: "YB999",
          USEMONEY: 120,
          MCARD_NAME: "新会员",
          MCARD_PHONE: "13900000000",
          MCARD_TYPENAME: "普卡",
          SETTLETIME: "2025-01-02 10:00:00",
          xfsc: 120,
          xfzs: 0,
        },
      ],
      settlementTypeNameById: new Map([[3, "会员"]]),
      rechargeTypeNameById: new Map([[2, "会员充值"]]),
    });

    expect(upsertMemberCurrent).toHaveBeenCalledWith([
      expect.objectContaining({
        memberId: expect.stringContaining("legacy-"),
        phone: "13900000000",
      }),
    ]);
    expect(upsertMemberCards).toHaveBeenCalledWith([
      expect.objectContaining({
        cardNo: "YB999",
      }),
    ]);
    expect(replaceMemberDailySnapshots).toHaveBeenCalledWith(
      ORG_ID,
      "2025-01-01",
      expect.arrayContaining([expect.objectContaining({ phone: "13900000000" })]),
    );
    expect(replaceMemberCardDailySnapshots).toHaveBeenCalledWith(
      ORG_ID,
      "2025-01-01",
      expect.arrayContaining([expect.objectContaining({ cardNo: "YB999" })]),
    );
    expect(upsertRechargeBills).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ rechargeId: "recharge-001" })]),
    );
    expect(upsertConsumeBills).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ settleId: "consume-001" })]),
      { refreshViews: false },
    );
    expect(upsertUserTrades).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ tradeNo: "legacy-settle:consume-001:1" })]),
    );
    expect(forceRebuildAnalyticsViews).toHaveBeenCalledTimes(1);
  });

  it("can skip the final refresh so outer rebuild scripts control the single refresh point", async () => {
    const forceRebuildAnalyticsViews = vi.fn().mockResolvedValue(undefined);
    const store = {
      listCurrentMembers: vi.fn().mockResolvedValue([]),
      listCurrentMemberCards: vi.fn().mockResolvedValue([]),
      upsertMemberCurrent: vi.fn().mockResolvedValue(undefined),
      upsertMemberCards: vi.fn().mockResolvedValue(undefined),
      replaceMemberDailySnapshots: vi.fn().mockResolvedValue(undefined),
      replaceMemberCardDailySnapshots: vi.fn().mockResolvedValue(undefined),
      upsertRechargeBills: vi.fn().mockResolvedValue(undefined),
      upsertConsumeBills: vi.fn().mockResolvedValue(undefined),
      upsertUserTrades: vi.fn().mockResolvedValue(undefined),
      forceRebuildAnalyticsViews,
    };

    await importLegacyYingbinData({
      orgId: ORG_ID,
      storeName: STORE_NAME,
      store: store as never,
      currentCardRows: [],
      snapshotCardRows: [],
      rechargeRows: [],
      consumeRows: [],
      settlementRows: [],
      settlementTypeNameById: new Map(),
      rechargeTypeNameById: new Map(),
      refreshViews: false,
    });

    expect(forceRebuildAnalyticsViews).not.toHaveBeenCalled();
  });
});
