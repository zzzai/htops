import { describe, expect, it } from "vitest";
import {
  buildCustomerConversionCohorts,
  buildCustomerSegments,
  buildCustomerTechServiceLinks,
  buildMemberActionProfileBridge,
  extractConsumeCustomerRefs,
} from "./customer-intelligence.js";
import type {
  ConsumeBillRecord,
  MemberCardCurrentRecord,
  MemberCurrentRecord,
  TechUpClockRecord,
} from "./types.js";

function consumeRow(params: {
  settleId: string;
  settleNo: string;
  bizDate: string;
  optTime: string;
  payAmount: number;
  consumeAmount: number;
  infos?: string[];
  payments: Array<Record<string, unknown>>;
  extraRaw?: Record<string, unknown>;
}): ConsumeBillRecord {
  return {
    orgId: "1001",
    settleId: params.settleId,
    settleNo: params.settleNo,
    payAmount: params.payAmount,
    consumeAmount: params.consumeAmount,
    discountAmount: 0,
    antiFlag: false,
    optTime: params.optTime,
    bizDate: params.bizDate,
    rawJson: JSON.stringify({
      SettleId: params.settleId,
      SettleNo: params.settleNo,
      Infos: params.infos ?? [],
      Payments: params.payments,
      ...(params.extraRaw ?? {}),
    }),
  };
}

function clockRow(params: {
  settleNo: string;
  bizDate: string;
  techCode: string;
  techName: string;
  itemName: string;
  turnover: number;
  settleTime: string;
}): TechUpClockRecord {
  return {
    orgId: "1001",
    rowFingerprint: `${params.settleNo}-${params.techCode}-${params.itemName}`,
    personCode: params.techCode,
    personName: params.techName,
    settleNo: params.settleNo,
    itemName: params.itemName,
    count: 1,
    turnover: params.turnover,
    comm: 80,
    clockType: "2",
    ctime: params.settleTime,
    settleTime: params.settleTime,
    bizDate: params.bizDate,
    rawJson: JSON.stringify({
      SettleNo: params.settleNo,
      PersonCode: params.techCode,
      PersonName: params.techName,
      ItemName: params.itemName,
    }),
  };
}

describe("customer-intelligence", () => {
  it("extracts customer refs from consume Infos rows", () => {
    const refs = extractConsumeCustomerRefs(
      JSON.stringify({
        Infos: ["王先生 (金悦卡) [yw001],消费300.00元(积分+0);", "散客张先生,消费229.00元;"],
      }),
    );

    expect(refs).toEqual([
      {
        displayName: "王先生",
        infoText: "王先生 (金悦卡) [yw001],消费300.00元(积分+0);",
        memberLabel: "金悦卡",
        referenceCode: "yw001",
      },
      {
        displayName: "散客张先生",
        infoText: "散客张先生,消费229.00元;",
        memberLabel: undefined,
        referenceCode: undefined,
      },
    ]);
  });

  it("builds customer-tech links and customer segments from real settle keys", () => {
    const currentMembers: MemberCurrentRecord[] = [
      {
        orgId: "1001",
        memberId: "member-001",
        name: "王先生",
        phone: "13800000001",
        storedAmount: 1200,
        consumeAmount: 1800,
        silentDays: 0,
        rawJson: "{}",
      },
    ];
    const currentCards: MemberCardCurrentRecord[] = [
      {
        orgId: "1001",
        memberId: "member-001",
        cardId: "card-001",
        cardNo: "yw001",
        rawJson: "{}",
      },
    ];

    const consumeHistory: ConsumeBillRecord[] = [
      consumeRow({
        settleId: "S-001",
        settleNo: "NO-001",
        bizDate: "2026-03-10",
        optTime: "2026-03-10 21:00:00",
        payAmount: 260,
        consumeAmount: 260,
        infos: ["王先生 (金悦卡) [yw001],消费260.00元(积分+0);"],
        payments: [{ Name: "会员", Amount: 260, PaymentType: 3 }],
      }),
      consumeRow({
        settleId: "S-002",
        settleNo: "NO-002",
        bizDate: "2026-03-20",
        optTime: "2026-03-20 21:00:00",
        payAmount: 280,
        consumeAmount: 280,
        infos: ["王先生 (金悦卡) [yw001],消费280.00元(积分+0);"],
        payments: [{ Name: "会员", Amount: 280, PaymentType: 3 }],
      }),
      consumeRow({
        settleId: "S-003",
        settleNo: "NO-003",
        bizDate: "2026-03-28",
        optTime: "2026-03-28 21:00:00",
        payAmount: 320,
        consumeAmount: 320,
        infos: ["王先生 (金悦卡) [yw001],消费320.00元(积分+0);"],
        payments: [{ Name: "会员", Amount: 320, PaymentType: 3 }],
      }),
      consumeRow({
        settleId: "S-004",
        settleNo: "NO-004",
        bizDate: "2026-03-30",
        optTime: "2026-03-30 21:00:00",
        payAmount: 360,
        consumeAmount: 360,
        infos: ["王先生 (金悦卡) [yw001],消费360.00元(积分+0);"],
        payments: [{ Name: "会员", Amount: 360, PaymentType: 3 }],
      }),
      consumeRow({
        settleId: "S-005",
        settleNo: "NO-005",
        bizDate: "2026-03-30",
        optTime: "2026-03-30 22:00:00",
        payAmount: 199,
        consumeAmount: 199,
        infos: ["李先生 [mt001],消费199.00元;"],
        payments: [{ Name: "美团", Amount: 199, PaymentType: 8 }],
      }),
    ];

    const techHistory: TechUpClockRecord[] = [
      clockRow({
        settleNo: "NO-001",
        bizDate: "2026-03-10",
        techCode: "T001",
        techName: "技师甲",
        itemName: "荷悦SPA",
        turnover: 260,
        settleTime: "2026-03-10 22:00:00",
      }),
      clockRow({
        settleNo: "NO-002",
        bizDate: "2026-03-20",
        techCode: "T001",
        techName: "技师甲",
        itemName: "荷悦SPA",
        turnover: 280,
        settleTime: "2026-03-20 22:00:00",
      }),
      clockRow({
        settleNo: "NO-003",
        bizDate: "2026-03-28",
        techCode: "T001",
        techName: "技师甲",
        itemName: "荷悦SPA",
        turnover: 320,
        settleTime: "2026-03-28 22:00:00",
      }),
      clockRow({
        settleNo: "NO-004",
        bizDate: "2026-03-30",
        techCode: "T001",
        techName: "技师甲",
        itemName: "荷悦SPA",
        turnover: 360,
        settleTime: "2026-03-30 22:00:00",
      }),
      clockRow({
        settleNo: "NO-005",
        bizDate: "2026-03-30",
        techCode: "T002",
        techName: "技师乙",
        itemName: "悦色足道",
        turnover: 199,
        settleTime: "2026-03-30 23:00:00",
      }),
    ];

    const dayLinks = buildCustomerTechServiceLinks({
      bizDate: "2026-03-30",
      consumeBills: consumeHistory.filter((row) => row.bizDate === "2026-03-30"),
      currentMemberCards: currentCards,
      currentMembers,
      orgId: "1001",
      techUpClockRows: techHistory.filter((row) => row.bizDate === "2026-03-30"),
    });

    expect(dayLinks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          settleNo: "NO-004",
          customerIdentityKey: "member:member-001",
          customerIdentityType: "member",
          customerDisplayName: "王先生",
          memberId: "member-001",
          techCode: "T001",
          techName: "技师甲",
          linkConfidence: "single-customer",
          identityStable: true,
        }),
        expect.objectContaining({
          settleNo: "NO-005",
          customerIdentityKey: "customer-ref:mt001",
          customerIdentityType: "customer-ref",
          customerDisplayName: "李先生",
          techCode: "T002",
          techName: "技师乙",
          identityStable: true,
        }),
      ]),
    );

    const historyLinks = buildCustomerTechServiceLinks({
      bizDate: "2026-03-30",
      consumeBills: consumeHistory,
      currentMemberCards: currentCards,
      currentMembers,
      orgId: "1001",
      techUpClockRows: techHistory,
    });

    const segments = buildCustomerSegments({
      bizDate: "2026-03-30",
      consumeBills: consumeHistory,
      currentMemberCards: currentCards,
      currentMembers,
      customerTechLinks: historyLinks,
      orgId: "1001",
    });

    expect(segments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          customerIdentityKey: "member:member-001",
          customerDisplayName: "王先生",
          memberId: "member-001",
          identityStable: true,
          visitCount90d: 4,
          payAmount90d: 1220,
          paymentSegment: "member-only",
          techLoyaltySegment: "single-tech-loyal",
          primarySegment: "important-value-member",
        }),
        expect.objectContaining({
          customerIdentityKey: "customer-ref:mt001",
          customerDisplayName: "李先生",
          identityStable: true,
          paymentSegment: "groupbuy-only",
          primarySegment: "groupbuy-retain-candidate",
        }),
      ]),
    );
  });

  it("applies store-level primary segment threshold overrides when building segments", () => {
    const currentMembers: MemberCurrentRecord[] = [
      {
        orgId: "1001",
        memberId: "member-001",
        name: "王先生",
        phone: "13800000001",
        storedAmount: 1200,
        consumeAmount: 1800,
        silentDays: 0,
        rawJson: "{}",
      },
    ];
    const currentCards: MemberCardCurrentRecord[] = [
      {
        orgId: "1001",
        memberId: "member-001",
        cardId: "card-001",
        cardNo: "yw001",
        rawJson: "{}",
      },
    ];
    const consumeHistory: ConsumeBillRecord[] = [
      consumeRow({
        settleId: "S-101",
        settleNo: "NO-101",
        bizDate: "2026-03-10",
        optTime: "2026-03-10 21:00:00",
        payAmount: 205,
        consumeAmount: 205,
        infos: ["王先生 (金悦卡) [yw001],消费205.00元(积分+0);"],
        payments: [{ Name: "会员", Amount: 205, PaymentType: 3 }],
      }),
      consumeRow({
        settleId: "S-102",
        settleNo: "NO-102",
        bizDate: "2026-03-18",
        optTime: "2026-03-18 21:00:00",
        payAmount: 205,
        consumeAmount: 205,
        infos: ["王先生 (金悦卡) [yw001],消费205.00元(积分+0);"],
        payments: [{ Name: "会员", Amount: 205, PaymentType: 3 }],
      }),
      consumeRow({
        settleId: "S-103",
        settleNo: "NO-103",
        bizDate: "2026-03-24",
        optTime: "2026-03-24 21:00:00",
        payAmount: 205,
        consumeAmount: 205,
        infos: ["王先生 (金悦卡) [yw001],消费205.00元(积分+0);"],
        payments: [{ Name: "会员", Amount: 205, PaymentType: 3 }],
      }),
      consumeRow({
        settleId: "S-104",
        settleNo: "NO-104",
        bizDate: "2026-03-30",
        optTime: "2026-03-30 21:00:00",
        payAmount: 205,
        consumeAmount: 205,
        infos: ["王先生 (金悦卡) [yw001],消费205.00元(积分+0);"],
        payments: [{ Name: "会员", Amount: 205, PaymentType: 3 }],
      }),
    ];

    const defaultSegments = buildCustomerSegments({
      bizDate: "2026-03-30",
      consumeBills: consumeHistory,
      currentMemberCards: currentCards,
      currentMembers,
      customerTechLinks: [],
      orgId: "1001",
    });

    const tunedSegments = buildCustomerSegments({
      bizDate: "2026-03-30",
      consumeBills: consumeHistory,
      currentMemberCards: currentCards,
      currentMembers,
      customerTechLinks: [],
      orgId: "1001",
      storeConfig: {
        orgId: "1001",
        storeName: "一号店",
        rawAliases: [],
        isActive: true,
        customerGrowth: {
          primarySegmentThresholds: {
            highValueMemberPayAmount90d: 800,
          },
        },
      },
    });

    expect(defaultSegments[0]?.primarySegment).toBe("active-member");
    expect(tunedSegments[0]?.primarySegment).toBe("important-value-member");
  });

  it("resolves stable member identity from fallback consume fields when Infos is missing", () => {
    const currentMembers: MemberCurrentRecord[] = [
      {
        orgId: "1001",
        memberId: "member-001",
        name: "王先生",
        phone: "13800000001",
        storedAmount: 1200,
        consumeAmount: 1800,
        silentDays: 0,
        rawJson: "{}",
      },
    ];
    const currentCards: MemberCardCurrentRecord[] = [
      {
        orgId: "1001",
        memberId: "member-001",
        cardId: "card-001",
        cardNo: "yw001",
        rawJson: "{}",
      },
    ];

    const links = buildCustomerTechServiceLinks({
      orgId: "1001",
      bizDate: "2026-03-30",
      consumeBills: [
        consumeRow({
          settleId: "S-100",
          settleNo: "NO-100",
          bizDate: "2026-03-30",
          optTime: "2026-03-30 21:00:00",
          payAmount: 260,
          consumeAmount: 260,
          payments: [{ Name: "会员", Amount: 260, PaymentType: 3 }],
          extraRaw: {
            CardNo: "yw001",
            MemberPhone: "13800000001",
            MemberName: "王先生",
          },
        }),
      ],
      techUpClockRows: [
        clockRow({
          settleNo: "NO-100",
          bizDate: "2026-03-30",
          techCode: "T001",
          techName: "技师甲",
          itemName: "荷悦SPA",
          turnover: 260,
          settleTime: "2026-03-30 22:00:00",
        }),
      ],
      currentMembers,
      currentMemberCards: currentCards,
    });

    expect(links).toEqual([
      expect.objectContaining({
        customerIdentityKey: "member:member-001",
        customerIdentityType: "member",
        customerDisplayName: "王先生",
        memberId: "member-001",
        referenceCode: "yw001",
        identityStable: true,
      }),
    ]);
  });

  it("builds rolling groupbuy conversion cohorts with 7-day and 30-day attribution", () => {
    const currentMembers: MemberCurrentRecord[] = [
      {
        orgId: "1001",
        memberId: "member-001",
        name: "王先生",
        phone: "13800000001",
        storedAmount: 1200,
        consumeAmount: 1800,
        createdTime: "2026-03-03 10:00:00",
        lastConsumeTime: "2026-03-20 21:00:00",
        silentDays: 10,
        rawJson: "{}",
      },
    ];
    const currentCards: MemberCardCurrentRecord[] = [
      {
        orgId: "1001",
        memberId: "member-001",
        cardId: "card-001",
        cardNo: "yw001",
        rawJson: "{}",
      },
    ];

    const consumeHistory: ConsumeBillRecord[] = [
      consumeRow({
        settleId: "S-001",
        settleNo: "NO-001",
        bizDate: "2026-03-01",
        optTime: "2026-03-01 21:00:00",
        payAmount: 199,
        consumeAmount: 199,
        infos: ["王先生 (金悦卡) [yw001],消费199.00元;"],
        payments: [{ Name: "美团", Amount: 199, PaymentType: 8 }],
      }),
      consumeRow({
        settleId: "S-002",
        settleNo: "NO-002",
        bizDate: "2026-03-03",
        optTime: "2026-03-03 21:00:00",
        payAmount: 260,
        consumeAmount: 260,
        infos: ["王先生 (金悦卡) [yw001],消费260.00元;"],
        payments: [{ Name: "会员", Amount: 260, PaymentType: 3 }],
      }),
      consumeRow({
        settleId: "S-003",
        settleNo: "NO-003",
        bizDate: "2026-03-05",
        optTime: "2026-03-05 21:00:00",
        payAmount: 300,
        consumeAmount: 300,
        infos: ["王先生 (金悦卡) [yw001],消费300.00元;"],
        payments: [{ Name: "会员", Amount: 300, PaymentType: 3 }],
      }),
      consumeRow({
        settleId: "S-004",
        settleNo: "NO-004",
        bizDate: "2026-03-10",
        optTime: "2026-03-10 21:00:00",
        payAmount: 320,
        consumeAmount: 320,
        infos: ["王先生 (金悦卡) [yw001],消费320.00元;"],
        payments: [{ Name: "会员", Amount: 320, PaymentType: 3 }],
      }),
      consumeRow({
        settleId: "S-005",
        settleNo: "NO-005",
        bizDate: "2026-03-20",
        optTime: "2026-03-20 21:00:00",
        payAmount: 360,
        consumeAmount: 360,
        infos: ["王先生 (金悦卡) [yw001],消费360.00元;"],
        payments: [{ Name: "会员", Amount: 360, PaymentType: 3 }],
      }),
    ];

    const cohorts = buildCustomerConversionCohorts({
      orgId: "1001",
      bizDate: "2026-03-30",
      consumeBills: consumeHistory,
      rechargeBills: [
        {
          orgId: "1001",
          rechargeId: "R-001",
          realityAmount: 500,
          totalAmount: 500,
          donateAmount: 0,
          antiFlag: false,
          optTime: "2026-03-04 10:00:00",
          bizDate: "2026-03-04",
          rawJson: JSON.stringify({
            CardNo: "yw001",
            MemberPhone: "13800000001",
            MemberName: "王先生",
          }),
        },
      ],
      currentMembers,
      currentMemberCards: currentCards,
    });

    expect(cohorts).toEqual([
      expect.objectContaining({
        orgId: "1001",
        bizDate: "2026-03-30",
        customerIdentityKey: "member:member-001",
        customerIdentityType: "member",
        customerDisplayName: "王先生",
        memberId: "member-001",
        referenceCode: "yw001",
        firstGroupbuyBizDate: "2026-03-01",
        firstObservedIsGroupbuy: true,
        revisitWithin7d: true,
        revisitWithin30d: true,
        cardOpenedWithin7d: true,
        storedValueConvertedWithin7d: true,
        memberPayConvertedWithin30d: true,
        visitCount30dAfterGroupbuy: 5,
        payAmount30dAfterGroupbuy: 1439,
        memberPayAmount30dAfterGroupbuy: 1240,
        highValueMemberWithin30d: true,
      }),
    ]);
  });

  it("does not treat groupbuy rows without customer Infos as stable customer identities", () => {
    const cohorts = buildCustomerConversionCohorts({
      orgId: "1001",
      bizDate: "2026-03-30",
      consumeBills: [
        consumeRow({
          settleId: "S-GB-001",
          settleNo: "NO-GB-001",
          bizDate: "2026-03-24",
          optTime: "2026-03-24 20:00:00",
          payAmount: 199,
          consumeAmount: 199,
          infos: [],
          payments: [{ Name: "美团", Amount: 199, PaymentType: -1 }],
          extraRaw: {
            CCode: "608",
            CName: "赵敬敬",
            OptCode: "808",
            OptName: "宁宁",
          },
        }),
      ],
      rechargeBills: [],
      currentMembers: [],
      currentMemberCards: [],
    });

    expect(cohorts).toEqual([]);
  });

  it("does not duplicate member spend across multiple stable customers from one settle bill", () => {
    const currentMembers: MemberCurrentRecord[] = [
      {
        orgId: "1001",
        memberId: "member-001",
        name: "王先生",
        phone: "13800000001",
        storedAmount: 1200,
        consumeAmount: 1800,
        silentDays: 0,
        rawJson: "{}",
      },
      {
        orgId: "1001",
        memberId: "member-002",
        name: "李女士",
        phone: "13800000002",
        storedAmount: 800,
        consumeAmount: 1200,
        silentDays: 0,
        rawJson: "{}",
      },
    ];
    const currentCards: MemberCardCurrentRecord[] = [
      {
        orgId: "1001",
        memberId: "member-001",
        cardId: "card-001",
        cardNo: "yw001",
        rawJson: "{}",
      },
      {
        orgId: "1001",
        memberId: "member-002",
        cardId: "card-002",
        cardNo: "yw002",
        rawJson: "{}",
      },
    ];

    const segments = buildCustomerSegments({
      orgId: "1001",
      bizDate: "2026-03-30",
      consumeBills: [
        consumeRow({
          settleId: "S-001",
          settleNo: "NO-001",
          bizDate: "2026-03-10",
          optTime: "2026-03-10 20:00:00",
          payAmount: 260,
          consumeAmount: 260,
          infos: ["王先生 (金悦卡) [yw001],消费260.00元;"],
          payments: [{ Name: "会员", Amount: 260, PaymentType: 3 }],
        }),
        consumeRow({
          settleId: "S-002",
          settleNo: "NO-002",
          bizDate: "2026-03-18",
          optTime: "2026-03-18 18:00:00",
          payAmount: 180,
          consumeAmount: 180,
          infos: ["李女士 (金悦卡) [yw002],消费180.00元;"],
          payments: [{ Name: "会员", Amount: 180, PaymentType: 3 }],
        }),
        consumeRow({
          settleId: "S-003",
          settleNo: "NO-003",
          bizDate: "2026-03-26",
          optTime: "2026-03-26 22:00:00",
          payAmount: 400,
          consumeAmount: 400,
          infos: ["王先生 (金悦卡) [yw001],消费200.00元;", "李女士 (金悦卡) [yw002],消费200.00元;"],
          payments: [{ Name: "会员", Amount: 400, PaymentType: 3 }],
        }),
      ],
      currentMembers,
      currentMemberCards: currentCards,
      customerTechLinks: [],
    });

    expect(segments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          customerIdentityKey: "member:member-001",
          visitCount90d: 1,
          payAmount90d: 260,
          memberPayAmount90d: 260,
        }),
        expect.objectContaining({
          customerIdentityKey: "member:member-002",
          visitCount90d: 1,
          payAmount90d: 180,
          memberPayAmount90d: 180,
        }),
      ]),
    );
  });

  it("does not open conversion cohorts from ambiguous multi-customer first groupbuy settles", () => {
    const currentMembers: MemberCurrentRecord[] = [
      {
        orgId: "1001",
        memberId: "member-001",
        name: "王先生",
        phone: "13800000001",
        storedAmount: 1200,
        consumeAmount: 1800,
        createdTime: "2026-03-03 10:00:00",
        lastConsumeTime: "2026-03-20 21:00:00",
        silentDays: 10,
        rawJson: "{}",
      },
      {
        orgId: "1001",
        memberId: "member-002",
        name: "李女士",
        phone: "13800000002",
        storedAmount: 800,
        consumeAmount: 1200,
        createdTime: "2026-03-03 10:00:00",
        lastConsumeTime: "2026-03-20 21:00:00",
        silentDays: 10,
        rawJson: "{}",
      },
    ];
    const currentCards: MemberCardCurrentRecord[] = [
      {
        orgId: "1001",
        memberId: "member-001",
        cardId: "card-001",
        cardNo: "yw001",
        rawJson: "{}",
      },
      {
        orgId: "1001",
        memberId: "member-002",
        cardId: "card-002",
        cardNo: "yw002",
        rawJson: "{}",
      },
    ];

    const cohorts = buildCustomerConversionCohorts({
      orgId: "1001",
      bizDate: "2026-03-30",
      consumeBills: [
        consumeRow({
          settleId: "S-001",
          settleNo: "NO-001",
          bizDate: "2026-03-01",
          optTime: "2026-03-01 21:00:00",
          payAmount: 199,
          consumeAmount: 199,
          infos: ["王先生 (金悦卡) [yw001],消费99.00元;", "李女士 (金悦卡) [yw002],消费100.00元;"],
          payments: [{ Name: "美团", Amount: 199, PaymentType: 8 }],
        }),
        consumeRow({
          settleId: "S-002",
          settleNo: "NO-002",
          bizDate: "2026-03-03",
          optTime: "2026-03-03 21:00:00",
          payAmount: 260,
          consumeAmount: 260,
          infos: ["王先生 (金悦卡) [yw001],消费260.00元;"],
          payments: [{ Name: "会员", Amount: 260, PaymentType: 3 }],
        }),
      ],
      rechargeBills: [],
      currentMembers,
      currentMemberCards: currentCards,
    });

    expect(cohorts).toEqual([]);
  });
  it("exposes a bounded action-profile bridge from the customer intelligence surface", () => {
    const bridge = buildMemberActionProfileBridge({
      orgId: "1001",
      bizDate: "2026-04-21",
      memberId: "member-001",
      customerIdentityKey: "member:member-001",
      customerDisplayName: "王先生",
      identityProfileJson: {},
      spendingProfileJson: {},
      serviceNeedProfileJson: {
        primary_need: "肩颈放松",
        confidence_discount: 0.08,
      },
      interactionProfileJson: {
        confidence_discount: 0.2,
      },
      preferenceProfileJson: {
        preferred_daypart: "夜场",
        preferred_channel: "企微",
        preferred_tech_name: "技师甲",
      },
      scenarioProfileJson: {},
      relationshipProfileJson: {
        top_tech_name: "技师甲",
      },
      opportunityProfileJson: {},
      sourceSignalIds: ["sig-1"],
      updatedAt: "2026-04-21T10:00:00.000Z",
    });

    expect(bridge).toMatchObject({
      memberId: "member-001",
      serviceNeed: "肩颈放松",
      preferredTouchDaypart: "late-night",
      preferredChannel: "企微",
      preferredTechName: "技师甲",
    });
  });

});
