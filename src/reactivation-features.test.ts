import { DataType, newDb as createBaseDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import { buildMemberReactivationFeaturesForBizDate, rebuildMemberReactivationFeaturesForDateRange } from "./reactivation-features.js";
import { HetangOpsStore } from "./store.js";
import type {
  ConsumeBillRecord,
  CustomerSegmentRecord,
  MemberCardCurrentRecord,
  MemberCurrentRecord,
  RechargeBillRecord,
} from "./types.js";

function newDb() {
  const db = createBaseDb();
  const heldLocks = new Set<number>();
  db.public.registerFunction({
    name: "pg_advisory_lock",
    args: [DataType.bigint],
    returns: DataType.bool,
    implementation: (lockKey: number | bigint) => {
      heldLocks.add(Number(lockKey));
      return true;
    },
  });
  db.public.registerFunction({
    name: "pg_try_advisory_lock",
    args: [DataType.bigint],
    returns: DataType.bool,
    implementation: (lockKey: number | bigint) => {
      const normalized = Number(lockKey);
      if (heldLocks.has(normalized)) {
        return false;
      }
      heldLocks.add(normalized);
      return true;
    },
  });
  db.public.registerFunction({
    name: "pg_advisory_unlock",
    args: [DataType.bigint],
    returns: DataType.bool,
    implementation: (lockKey: number | bigint) => heldLocks.delete(Number(lockKey)),
  });
  db.public.registerFunction({
    name: "right",
    args: [DataType.text, DataType.integer],
    returns: DataType.text,
    implementation: (value: string, count: number) =>
      typeof value === "string" ? value.slice(-Math.max(0, Number(count))) : "",
  });
  return db;
}

const currentMembers: MemberCurrentRecord[] = [
  {
    orgId: "627149864218629",
    memberId: "M-001",
    name: "王女士",
    phone: "13800000001",
    storedAmount: 900,
    consumeAmount: 2600,
    createdTime: "2025-10-10 10:00:00",
    lastConsumeTime: "2026-04-08 20:00:00",
    silentDays: 0,
    rawJson: "{}",
  },
  {
    orgId: "627149864218629",
    memberId: "M-002",
    name: "李先生",
    phone: "13800000002",
    storedAmount: 80,
    consumeAmount: 900,
    createdTime: "2025-11-10 10:00:00",
    lastConsumeTime: "2026-03-01 20:00:00",
    silentDays: 38,
    rawJson: "{}",
  },
];

const currentCards: MemberCardCurrentRecord[] = [
  {
    orgId: "627149864218629",
    memberId: "M-001",
    cardId: "CARD-001",
    cardNo: "YB001",
    rawJson: "{}",
  },
  {
    orgId: "627149864218629",
    memberId: "M-002",
    cardId: "CARD-002",
    cardNo: "YB002",
    rawJson: "{}",
  },
];

const consumeBills: ConsumeBillRecord[] = [
  {
    orgId: "627149864218629",
    settleId: "S-001",
    settleNo: "NO-001",
    payAmount: 300,
    consumeAmount: 300,
    discountAmount: 0,
    antiFlag: false,
    optTime: "2026-03-12 20:00:00",
    bizDate: "2026-03-12",
    rawJson: JSON.stringify({
      Infos: ["王女士 (金卡) [YB001],消费300.00元;"],
      Payments: [{ Name: "会员", Amount: 300, PaymentType: 3 }],
    }),
  },
  {
    orgId: "627149864218629",
    settleId: "S-002",
    settleNo: "NO-002",
    payAmount: 320,
    consumeAmount: 320,
    discountAmount: 0,
    antiFlag: false,
    optTime: "2026-04-04 20:00:00",
    bizDate: "2026-04-04",
    rawJson: JSON.stringify({
      Infos: ["王女士 (金卡) [YB001],消费320.00元;"],
      Payments: [{ Name: "会员", Amount: 320, PaymentType: 3 }],
    }),
  },
  {
    orgId: "627149864218629",
    settleId: "S-003",
    settleNo: "NO-003",
    payAmount: 180,
    consumeAmount: 180,
    discountAmount: 0,
    antiFlag: false,
    optTime: "2026-02-18 18:00:00",
    bizDate: "2026-02-18",
    rawJson: JSON.stringify({
      Infos: ["李先生 (普卡) [YB002],消费180.00元;"],
      Payments: [{ Name: "会员", Amount: 180, PaymentType: 3 }],
    }),
  },
];

const rechargeBills: RechargeBillRecord[] = [
  {
    orgId: "627149864218629",
    rechargeId: "R-001",
    realityAmount: 500,
    totalAmount: 600,
    donateAmount: 100,
    antiFlag: false,
    optTime: "2026-03-20 12:00:00",
    bizDate: "2026-03-20",
    rawJson: JSON.stringify({
      CardNo: "YB001",
      CardId: "CARD-001",
      MemberName: "王女士",
    }),
  },
  {
    orgId: "627149864218629",
    rechargeId: "R-002",
    realityAmount: 300,
    totalAmount: 300,
    donateAmount: 0,
    antiFlag: false,
    optTime: "2026-01-15 12:00:00",
    bizDate: "2026-01-15",
    rawJson: JSON.stringify({
      CardNo: "YB002",
      CardId: "CARD-002",
      MemberName: "李先生",
    }),
  },
];

function segmentRow(overrides: Partial<CustomerSegmentRecord>): CustomerSegmentRecord {
  return {
    orgId: "627149864218629",
    bizDate: overrides.bizDate ?? "2026-04-08",
    customerIdentityKey: `member:${overrides.memberId ?? "M-001"}`,
    customerIdentityType: "member",
    customerDisplayName: overrides.customerDisplayName ?? "王女士",
    memberId: overrides.memberId ?? "M-001",
    memberCardNo: overrides.memberCardNo ?? "YB001",
    referenceCode: overrides.referenceCode ?? "YB001",
    memberLabel: overrides.memberLabel ?? "金卡",
    identityStable: true,
    segmentEligible: true,
    firstBizDate: "2025-10-10",
    lastBizDate: overrides.lastBizDate ?? "2026-04-04",
    daysSinceLastVisit: overrides.daysSinceLastVisit ?? 4,
    visitCount30d: overrides.visitCount30d ?? 2,
    visitCount90d: overrides.visitCount90d ?? 5,
    payAmount30d: overrides.payAmount30d ?? 620,
    payAmount90d: overrides.payAmount90d ?? 1500,
    memberPayAmount90d: overrides.memberPayAmount90d ?? 620,
    groupbuyAmount90d: overrides.groupbuyAmount90d ?? 0,
    directPayAmount90d: overrides.directPayAmount90d ?? 300,
    distinctTechCount90d: overrides.distinctTechCount90d ?? 1,
    topTechCode: overrides.topTechCode ?? "T-001",
    topTechName: overrides.topTechName ?? "李红儿",
    topTechVisitCount90d: overrides.topTechVisitCount90d ?? 4,
    topTechVisitShare90d: overrides.topTechVisitShare90d ?? 0.8,
    recencySegment: overrides.recencySegment ?? "active-7d",
    frequencySegment: overrides.frequencySegment ?? "high-4-plus",
    monetarySegment: overrides.monetarySegment ?? "high-1000-plus",
    paymentSegment: overrides.paymentSegment ?? "mixed-member-nonmember",
    techLoyaltySegment: overrides.techLoyaltySegment ?? "single-tech-loyal",
    primarySegment: overrides.primarySegment ?? "important-value-member",
    tagKeys: overrides.tagKeys ?? ["important-value-member"],
    rawJson: overrides.rawJson ?? "{}",
  };
}

describe("reactivation-features", () => {
  it("builds inferred stored-value trajectory features from snapshots, recharge, and member pay history", () => {
    const rows = buildMemberReactivationFeaturesForBizDate({
      orgId: "627149864218629",
      bizDate: "2026-04-08",
      memberSnapshots: [
        {
          ...currentMembers[0]!,
          bizDate: "2026-04-08",
          storedAmount: 900,
        },
        {
          ...currentMembers[0]!,
          bizDate: "2026-04-01",
          storedAmount: 1220,
        },
        {
          ...currentMembers[0]!,
          bizDate: "2026-03-09",
          storedAmount: 1400,
        },
        {
          ...currentMembers[0]!,
          bizDate: "2026-01-08",
          storedAmount: 1700,
        },
        {
          ...currentMembers[1]!,
          bizDate: "2026-04-08",
          storedAmount: 80,
        },
      ],
      customerSegments: [
        segmentRow({ memberId: "M-001", customerDisplayName: "王女士" }),
        segmentRow({
          memberId: "M-002",
          customerDisplayName: "李先生",
          memberCardNo: "YB002",
          referenceCode: "YB002",
          lastBizDate: "2026-02-18",
          daysSinceLastVisit: 49,
          visitCount30d: 0,
          visitCount90d: 1,
          payAmount30d: 0,
          payAmount90d: 180,
          memberPayAmount90d: 180,
          directPayAmount90d: 0,
          topTechCode: undefined,
          topTechName: undefined,
          topTechVisitCount90d: 0,
          topTechVisitShare90d: null,
          recencySegment: "silent-31-90d",
          frequencySegment: "low-1",
          monetarySegment: "low-1-299",
          paymentSegment: "member-only",
          techLoyaltySegment: "no-tech-link",
          primarySegment: "sleeping-customer",
          tagKeys: ["sleeping-customer"],
        }),
      ],
      consumeBills,
      rechargeBills,
    });

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memberId: "M-001",
          currentStoredBalanceInferred: 900,
          storedBalance7dAgo: 1220,
          storedBalance30dAgo: 1400,
          storedBalance90dAgo: 1700,
          storedBalanceDelta7d: -320,
          storedBalanceDelta30d: -500,
          storedBalanceDelta90d: -800,
          rechargeTotal30d: 600,
          rechargeTotal90d: 600,
          memberPayAmount30d: 620,
          memberPayAmount90d: 620,
          daysSinceLastRecharge: 19,
        }),
        expect.objectContaining({
          memberId: "M-002",
          currentStoredBalanceInferred: 80,
          primarySegment: "sleeping-customer",
        }),
      ]),
    );
  });

  it("captures time-behavior preference and boosts overdue rhythmic members", () => {
    const bizDate = "2026-03-10";
    const members: MemberCurrentRecord[] = [
      {
        orgId: "627149864218629",
        memberId: "M-003",
        name: "周女士",
        phone: "13800000003",
        storedAmount: 500,
        consumeAmount: 1200,
        createdTime: "2025-10-10 10:00:00",
        lastConsumeTime: "2026-02-24 19:20:00",
        silentDays: 14,
        rawJson: "{}",
      },
      {
        orgId: "627149864218629",
        memberId: "M-004",
        name: "吴先生",
        phone: "13800000004",
        storedAmount: 500,
        consumeAmount: 1200,
        createdTime: "2025-10-10 10:00:00",
        lastConsumeTime: "2026-02-25 22:10:00",
        silentDays: 13,
        rawJson: "{}",
      },
    ];
    const cards: MemberCardCurrentRecord[] = [
      {
        orgId: "627149864218629",
        memberId: "M-003",
        cardId: "CARD-003",
        cardNo: "YB003",
        rawJson: "{}",
      },
      {
        orgId: "627149864218629",
        memberId: "M-004",
        cardId: "CARD-004",
        cardNo: "YB004",
        rawJson: "{}",
      },
    ];
    const timeBehaviorConsumeBills: ConsumeBillRecord[] = [
      {
        orgId: "627149864218629",
        settleId: "S-101",
        settleNo: "NO-101",
        payAmount: 300,
        consumeAmount: 300,
        discountAmount: 0,
        antiFlag: false,
        optTime: "2026-02-03 19:30:00",
        bizDate: "2026-02-03",
        rawJson: JSON.stringify({
          Infos: ["周女士 (金卡) [YB003],消费300.00元;"],
          Payments: [{ Name: "会员", Amount: 300, PaymentType: 3 }],
        }),
      },
      {
        orgId: "627149864218629",
        settleId: "S-102",
        settleNo: "NO-102",
        payAmount: 300,
        consumeAmount: 300,
        discountAmount: 0,
        antiFlag: false,
        optTime: "2026-02-10 19:45:00",
        bizDate: "2026-02-10",
        rawJson: JSON.stringify({
          Infos: ["周女士 (金卡) [YB003],消费300.00元;"],
          Payments: [{ Name: "会员", Amount: 300, PaymentType: 3 }],
        }),
      },
      {
        orgId: "627149864218629",
        settleId: "S-103",
        settleNo: "NO-103",
        payAmount: 300,
        consumeAmount: 300,
        discountAmount: 0,
        antiFlag: false,
        optTime: "2026-02-17 20:10:00",
        bizDate: "2026-02-17",
        rawJson: JSON.stringify({
          Infos: ["周女士 (金卡) [YB003],消费300.00元;"],
          Payments: [{ Name: "会员", Amount: 300, PaymentType: 3 }],
        }),
      },
      {
        orgId: "627149864218629",
        settleId: "S-104",
        settleNo: "NO-104",
        payAmount: 300,
        consumeAmount: 300,
        discountAmount: 0,
        antiFlag: false,
        optTime: "2026-02-24 19:20:00",
        bizDate: "2026-02-24",
        rawJson: JSON.stringify({
          Infos: ["周女士 (金卡) [YB003],消费300.00元;"],
          Payments: [{ Name: "会员", Amount: 300, PaymentType: 3 }],
        }),
      },
      {
        orgId: "627149864218629",
        settleId: "S-201",
        settleNo: "NO-201",
        payAmount: 300,
        consumeAmount: 300,
        discountAmount: 0,
        antiFlag: false,
        optTime: "2026-02-01 11:00:00",
        bizDate: "2026-02-01",
        rawJson: JSON.stringify({
          Infos: ["吴先生 (金卡) [YB004],消费300.00元;"],
          Payments: [{ Name: "会员", Amount: 300, PaymentType: 3 }],
        }),
      },
      {
        orgId: "627149864218629",
        settleId: "S-202",
        settleNo: "NO-202",
        payAmount: 300,
        consumeAmount: 300,
        discountAmount: 0,
        antiFlag: false,
        optTime: "2026-02-08 15:00:00",
        bizDate: "2026-02-08",
        rawJson: JSON.stringify({
          Infos: ["吴先生 (金卡) [YB004],消费300.00元;"],
          Payments: [{ Name: "会员", Amount: 300, PaymentType: 3 }],
        }),
      },
      {
        orgId: "627149864218629",
        settleId: "S-203",
        settleNo: "NO-203",
        payAmount: 300,
        consumeAmount: 300,
        discountAmount: 0,
        antiFlag: false,
        optTime: "2026-02-16 22:30:00",
        bizDate: "2026-02-16",
        rawJson: JSON.stringify({
          Infos: ["吴先生 (金卡) [YB004],消费300.00元;"],
          Payments: [{ Name: "会员", Amount: 300, PaymentType: 3 }],
        }),
      },
      {
        orgId: "627149864218629",
        settleId: "S-204",
        settleNo: "NO-204",
        payAmount: 300,
        consumeAmount: 300,
        discountAmount: 0,
        antiFlag: false,
        optTime: "2026-02-25 01:00:00",
        bizDate: "2026-02-24",
        rawJson: JSON.stringify({
          Infos: ["吴先生 (金卡) [YB004],消费300.00元;"],
          Payments: [{ Name: "会员", Amount: 300, PaymentType: 3 }],
        }),
      },
    ];

    const rows = buildMemberReactivationFeaturesForBizDate({
      orgId: "627149864218629",
      bizDate,
      memberSnapshots: [
        {
          ...members[0]!,
          bizDate,
          storedAmount: 500,
        },
        {
          ...members[1]!,
          bizDate,
          storedAmount: 500,
        },
      ],
      customerSegments: [
        segmentRow({
          bizDate,
          memberId: "M-003",
          customerDisplayName: "周女士",
          memberCardNo: "YB003",
          referenceCode: "YB003",
          lastBizDate: "2026-02-24",
          daysSinceLastVisit: 14,
          visitCount30d: 4,
          visitCount90d: 4,
          payAmount30d: 1200,
          payAmount90d: 1200,
          memberPayAmount90d: 1200,
          directPayAmount90d: 0,
          primarySegment: "important-value-member",
          tagKeys: ["important-value-member"],
        }),
        segmentRow({
          bizDate,
          memberId: "M-004",
          customerDisplayName: "吴先生",
          memberCardNo: "YB004",
          referenceCode: "YB004",
          lastBizDate: "2026-02-24",
          daysSinceLastVisit: 14,
          visitCount30d: 4,
          visitCount90d: 4,
          payAmount30d: 1200,
          payAmount90d: 1200,
          memberPayAmount90d: 1200,
          directPayAmount90d: 0,
          primarySegment: "important-value-member",
          tagKeys: ["important-value-member"],
        }),
      ],
      consumeBills: timeBehaviorConsumeBills,
      rechargeBills: [],
      currentMembers: members,
      currentMemberCards: cards,
    });

    const rhythmic = rows.find((row) => row.memberId === "M-003");
    const irregular = rows.find((row) => row.memberId === "M-004");

    expect(rhythmic).toEqual(
      expect.objectContaining({
        memberId: "M-003",
        dominantVisitDaypart: "after-work",
        preferredDaypartShare90d: 1,
        dominantVisitWeekday: "tuesday",
        preferredWeekdayShare90d: 1,
        dominantVisitMonthPhase: "early",
        weekendVisitShare90d: 0,
        lateNightVisitShare90d: 0,
        overnightVisitShare90d: 0,
      }),
    );
    expect(rhythmic?.averageVisitGapDays90d).toBeCloseTo(7, 2);
    expect(rhythmic?.visitGapStddevDays90d).toBeLessThan(0.05);
    expect(rhythmic?.cycleDeviationScore).toBeGreaterThan(0.9);
    expect(rhythmic?.timePreferenceConfidenceScore).toBeGreaterThan(0.8);
    expect(irregular?.preferredDaypartShare90d).toBeLessThan(rhythmic?.preferredDaypartShare90d ?? 0);
    expect(irregular?.timePreferenceConfidenceScore).toBeLessThan(
      rhythmic?.timePreferenceConfidenceScore ?? 0,
    );
    expect(rhythmic?.reactivationPriorityScore).toBeGreaterThan(
      irregular?.reactivationPriorityScore ?? 0,
    );
  });

  it("ignores ambiguous multi-member consume bills for member pay attribution and visit timing", () => {
    const bizDate = "2026-04-08";
    const rows = buildMemberReactivationFeaturesForBizDate({
      orgId: "627149864218629",
      bizDate,
      memberSnapshots: [
        {
          ...currentMembers[0]!,
          bizDate,
          storedAmount: 900,
        },
        {
          ...currentMembers[1]!,
          bizDate,
          storedAmount: 80,
        },
      ],
      customerSegments: [
        segmentRow({
          bizDate,
          memberId: "M-001",
          customerDisplayName: "王女士",
          memberCardNo: "YB001",
          referenceCode: "YB001",
          lastBizDate: "2026-04-01",
          daysSinceLastVisit: 7,
          visitCount30d: 1,
          visitCount90d: 1,
          payAmount30d: 260,
          payAmount90d: 260,
          memberPayAmount90d: 260,
          directPayAmount90d: 0,
          primarySegment: "active-member",
          tagKeys: ["active-member"],
        }),
        segmentRow({
          bizDate,
          memberId: "M-002",
          customerDisplayName: "李先生",
          memberCardNo: "YB002",
          referenceCode: "YB002",
          lastBizDate: "2026-03-25",
          daysSinceLastVisit: 14,
          visitCount30d: 1,
          visitCount90d: 1,
          payAmount30d: 180,
          payAmount90d: 180,
          memberPayAmount90d: 180,
          directPayAmount90d: 0,
          primarySegment: "active-member",
          tagKeys: ["active-member"],
        }),
      ],
      consumeBills: [
        {
          orgId: "627149864218629",
          settleId: "S-011",
          settleNo: "NO-011",
          payAmount: 260,
          consumeAmount: 260,
          discountAmount: 0,
          antiFlag: false,
          optTime: "2026-04-01 19:00:00",
          bizDate: "2026-04-01",
          rawJson: JSON.stringify({
            Infos: ["王女士 (金卡) [YB001],消费260.00元;"],
            Payments: [{ Name: "会员", Amount: 260, PaymentType: 3 }],
          }),
        },
        {
          orgId: "627149864218629",
          settleId: "S-012",
          settleNo: "NO-012",
          payAmount: 180,
          consumeAmount: 180,
          discountAmount: 0,
          antiFlag: false,
          optTime: "2026-03-25 10:00:00",
          bizDate: "2026-03-25",
          rawJson: JSON.stringify({
            Infos: ["李先生 (普卡) [YB002],消费180.00元;"],
            Payments: [{ Name: "会员", Amount: 180, PaymentType: 3 }],
          }),
        },
        {
          orgId: "627149864218629",
          settleId: "S-013",
          settleNo: "NO-013",
          payAmount: 400,
          consumeAmount: 400,
          discountAmount: 0,
          antiFlag: false,
          optTime: "2026-04-04 23:30:00",
          bizDate: "2026-04-04",
          rawJson: JSON.stringify({
            Infos: ["王女士 (金卡) [YB001],消费200.00元;", "李先生 (普卡) [YB002],消费200.00元;"],
            Payments: [{ Name: "会员", Amount: 400, PaymentType: 3 }],
          }),
        },
      ],
      rechargeBills: [],
    });

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memberId: "M-001",
          memberPayAmount30d: 260,
          memberPayAmount90d: 260,
          averageVisitGapDays90d: null,
        }),
        expect.objectContaining({
          memberId: "M-002",
          memberPayAmount30d: 180,
          memberPayAmount90d: 180,
          averageVisitGapDays90d: null,
        }),
      ]),
    );
  });

  it("rebuilds the feature mart through the store and keeps one row per member per day", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: [{ orgId: "627149864218629", storeName: "荷塘悦色迎宾店", rawAliases: [] }],
    });
    await store.initialize();

    await store.replaceMemberDailySnapshots(
      "627149864218629",
      "2026-04-08",
      currentMembers.map((row) => ({ ...row, storedAmount: row.memberId === "M-001" ? 900 : 80 })),
    );
    await store.replaceMemberCardDailySnapshots("627149864218629", "2026-04-08", currentCards);
    await store.replaceMemberDailySnapshots(
      "627149864218629",
      "2026-04-01",
      [{ ...currentMembers[0]!, storedAmount: 1220 }],
    );
    await store.replaceMemberCardDailySnapshots("627149864218629", "2026-04-01", [currentCards[0]!]);
    await store.replaceMemberDailySnapshots(
      "627149864218629",
      "2026-03-09",
      [{ ...currentMembers[0]!, storedAmount: 1400 }],
    );
    await store.replaceMemberCardDailySnapshots("627149864218629", "2026-03-09", [currentCards[0]!]);
    await store.replaceMemberDailySnapshots(
      "627149864218629",
      "2026-01-08",
      [{ ...currentMembers[0]!, storedAmount: 1700 }],
    );
    await store.replaceMemberCardDailySnapshots("627149864218629", "2026-01-08", [currentCards[0]!]);
    await store.upsertMemberCards(currentCards);
    await store.upsertConsumeBills(consumeBills);
    await store.upsertRechargeBills(rechargeBills);
    await store.replaceCustomerSegments(
      "627149864218629",
      "2026-04-08",
      [
        segmentRow({ memberId: "M-001", customerDisplayName: "王女士" }),
        segmentRow({
          memberId: "M-002",
          customerDisplayName: "李先生",
          memberCardNo: "YB002",
          referenceCode: "YB002",
          lastBizDate: "2026-02-18",
          daysSinceLastVisit: 49,
          visitCount30d: 0,
          visitCount90d: 1,
          payAmount30d: 0,
          payAmount90d: 180,
          memberPayAmount90d: 180,
          directPayAmount90d: 0,
          topTechCode: undefined,
          topTechName: undefined,
          topTechVisitCount90d: 0,
          topTechVisitShare90d: null,
          recencySegment: "silent-31-90d",
          frequencySegment: "low-1",
          monetarySegment: "low-1-299",
          paymentSegment: "member-only",
          techLoyaltySegment: "no-tech-link",
          primarySegment: "sleeping-customer",
          tagKeys: ["sleeping-customer"],
        }),
      ],
      "2026-04-09T09:00:00+08:00",
      { refreshViews: false },
    );

    await rebuildMemberReactivationFeaturesForDateRange({
      store,
      orgId: "627149864218629",
      startBizDate: "2026-04-08",
      endBizDate: "2026-04-08",
      refreshViews: false,
    });

    const rows = await (store as HetangOpsStore & {
      listMemberReactivationFeatures: (orgId: string, bizDate: string) => Promise<
        Array<{ memberId: string; currentStoredBalanceInferred: number; reactivationPriorityScore: number }>
      >;
    }).listMemberReactivationFeatures("627149864218629", "2026-04-08");

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        memberId: "M-001",
        currentStoredBalanceInferred: 900,
      }),
    );

    await store.close();
    await pool.end();
  });

  it("chunks long date-range rebuilds so reactivation refresh stays memory-safe", async () => {
    const snapshotCalls: Array<{ startBizDate: string; endBizDate: string }> = [];
    const cardSnapshotCalls: Array<{ startBizDate: string; endBizDate: string }> = [];
    const consumeCalls: Array<{ startBizDate: string; endBizDate: string }> = [];
    const rechargeCalls: Array<{ startBizDate: string; endBizDate: string }> = [];
    const replacedBizDates: string[] = [];

    const fakeStore = {
      listMemberDailySnapshotsByDateRange: async (
        orgId: string,
        startBizDate: string,
        endBizDate: string,
      ) => {
        snapshotCalls.push({ startBizDate, endBizDate });
        return [
          {
            ...currentMembers[0]!,
            orgId,
            bizDate: endBizDate,
            storedAmount: 300,
          },
        ];
      },
      listMemberCardDailySnapshotsByDateRange: async (
        orgId: string,
        startBizDate: string,
        endBizDate: string,
      ) => {
        cardSnapshotCalls.push({ startBizDate, endBizDate });
        return [
          {
            ...currentCards[0]!,
            orgId,
            bizDate: endBizDate,
          },
        ];
      },
      listConsumeBillsByDateRange: async (
        _orgId: string,
        startBizDate: string,
        endBizDate: string,
      ) => {
        consumeCalls.push({ startBizDate, endBizDate });
        return [];
      },
      listRechargeBillsByDateRange: async (
        _orgId: string,
        startBizDate: string,
        endBizDate: string,
      ) => {
        rechargeCalls.push({ startBizDate, endBizDate });
        return [];
      },
      listCustomerSegments: async (_orgId: string, bizDate: string) => [
        segmentRow({
          bizDate,
          memberId: "M-001",
          customerDisplayName: "王女士",
          lastBizDate: bizDate,
          daysSinceLastVisit: 0,
          visitCount30d: 1,
          visitCount90d: 1,
          payAmount30d: 100,
          payAmount90d: 100,
          memberPayAmount90d: 100,
        }),
      ],
      replaceMemberReactivationFeatures: async (_orgId: string, bizDate: string) => {
        replacedBizDates.push(bizDate);
      },
    } satisfies Partial<HetangOpsStore>;

    const rebuiltDays = await rebuildMemberReactivationFeaturesForDateRange({
      store: fakeStore as unknown as HetangOpsStore,
      orgId: "627149864218629",
      startBizDate: "2026-01-01",
      endBizDate: "2026-01-20",
    });

    expect(rebuiltDays).toBe(20);
    expect(snapshotCalls).toEqual([
      { startBizDate: "2025-10-03", endBizDate: "2026-01-07" },
      { startBizDate: "2025-10-10", endBizDate: "2026-01-14" },
      { startBizDate: "2025-10-17", endBizDate: "2026-01-20" },
    ]);
    expect(cardSnapshotCalls).toEqual(snapshotCalls);
    expect(consumeCalls).toEqual(snapshotCalls);
    expect(rechargeCalls).toEqual(snapshotCalls);
    expect(replacedBizDates).toHaveLength(20);
    expect(replacedBizDates[0]).toBe("2026-01-01");
    expect(replacedBizDates.at(-1)).toBe("2026-01-20");
  });
});
