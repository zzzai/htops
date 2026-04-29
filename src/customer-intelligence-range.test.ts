import { describe, expect, it, vi } from "vitest";
import {
  rebuildCustomerIntelligenceForBizDate,
  rebuildCustomerIntelligenceForDateRange,
} from "./customer-intelligence.js";
import { shiftBizDate } from "./time.js";

describe("rebuildCustomerIntelligenceForDateRange", () => {
  it("splits large rebuilds into smaller chunks and refreshes analytics views once", async () => {
    const store = {
      listMemberDailySnapshotsByDateRange: vi.fn().mockResolvedValue([]),
      listMemberCardDailySnapshotsByDateRange: vi.fn().mockResolvedValue([]),
      listConsumeBillsByDateRange: vi.fn().mockResolvedValue([]),
      listRechargeBillsByDateRange: vi.fn().mockResolvedValue([]),
      listTechUpClockByDateRange: vi.fn().mockResolvedValue([]),
      replaceCustomerTechLinks: vi.fn().mockResolvedValue(undefined),
      replaceCustomerSegments: vi.fn().mockResolvedValue(undefined),
      replaceCustomerConversionCohorts: vi.fn().mockResolvedValue(undefined),
      forceRebuildAnalyticsViews: vi.fn().mockResolvedValue(undefined),
    };

    const rebuiltDays = await rebuildCustomerIntelligenceForDateRange({
      store: store as never,
      orgId: "1001",
      startBizDate: "2026-04-01",
      endBizDate: "2026-04-05",
      chunkDays: 2,
    });

    expect(rebuiltDays).toBe(5);
    expect(store.listMemberDailySnapshotsByDateRange).toHaveBeenCalledTimes(3);
    expect(store.listMemberCardDailySnapshotsByDateRange).toHaveBeenCalledTimes(3);
    expect(store.listConsumeBillsByDateRange.mock.calls).toEqual([
      ["1001", shiftBizDate("2026-04-01", -179), "2026-04-02"],
      ["1001", shiftBizDate("2026-04-03", -179), "2026-04-04"],
      ["1001", shiftBizDate("2026-04-05", -179), "2026-04-05"],
    ]);
    expect(store.replaceCustomerTechLinks).toHaveBeenCalledTimes(5);
    expect(store.replaceCustomerSegments).toHaveBeenCalledTimes(5);
    expect(store.replaceCustomerConversionCohorts).toHaveBeenCalledTimes(5);
    expect(store.forceRebuildAnalyticsViews).toHaveBeenCalledTimes(1);
  });

  it("builds historical customer intelligence from daily member snapshots instead of current dimensions", async () => {
    const store = {
      listCurrentMembers: vi.fn().mockRejectedValue(new Error("should not read current members")),
      listCurrentMemberCards: vi
        .fn()
        .mockRejectedValue(new Error("should not read current member cards")),
      listMemberDailySnapshotsByDateRange: vi.fn().mockResolvedValue([
        {
          bizDate: "2026-04-03",
          orgId: "1001",
          memberId: "M-1",
          name: "历史会员",
          phone: "13800000001",
          storedAmount: 680,
          consumeAmount: 1180,
          createdTime: "2026-03-01 10:00:00",
          lastConsumeTime: "2026-04-03 21:20:00",
          silentDays: 0,
          rawJson: JSON.stringify({
            Id: "M-1",
            Phone: "13800000001",
            CTime: "2026-03-01 10:00:00",
            Storeds: [{ Id: "CARD-1", CardNo: "YW001", OrgId: "1001" }],
          }),
        },
      ]),
      listMemberCardDailySnapshotsByDateRange: vi.fn().mockResolvedValue([
        {
          bizDate: "2026-04-03",
          orgId: "1001",
          memberId: "M-1",
          cardId: "CARD-1",
          cardNo: "YW001",
          rawJson: JSON.stringify({ Id: "CARD-1", CardNo: "YW001", OrgId: "1001" }),
        },
      ]),
      listConsumeBillsByDateRange: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          settleId: "S-1",
          settleNo: "NO-1",
          payAmount: 168,
          consumeAmount: 168,
          discountAmount: 0,
          antiFlag: false,
          optTime: "2026-04-03 21:20:00",
          bizDate: "2026-04-03",
          rawJson: JSON.stringify({
            SettleId: "S-1",
            SettleNo: "NO-1",
            Infos: ["历史会员 (金悦卡) [YW001],消费168.00元;"],
            Payments: [{ Name: "会员", Amount: 168, PaymentType: 3 }],
          }),
        },
      ]),
      listRechargeBillsByDateRange: vi.fn().mockResolvedValue([]),
      listTechUpClockByDateRange: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          rowFingerprint: "clock-1",
          personCode: "T-1",
          personName: "技师甲",
          settleNo: "NO-1",
          itemName: "足疗",
          clockType: "2",
          count: 1,
          turnover: 168,
          comm: 48,
          settleTime: "2026-04-03 21:30:00",
          bizDate: "2026-04-03",
          rawJson: JSON.stringify({ ClockType: "点钟" }),
        },
      ]),
      replaceCustomerTechLinks: vi.fn().mockResolvedValue(undefined),
      replaceCustomerSegments: vi.fn().mockResolvedValue(undefined),
      replaceCustomerConversionCohorts: vi.fn().mockResolvedValue(undefined),
      forceRebuildAnalyticsViews: vi.fn().mockResolvedValue(undefined),
    };

    const result = await rebuildCustomerIntelligenceForBizDate({
      store: store as never,
      orgId: "1001",
      bizDate: "2026-04-03",
    });

    expect(store.listMemberDailySnapshotsByDateRange).toHaveBeenCalledWith(
      "1001",
      "2026-04-03",
      "2026-04-04",
    );
    expect(store.listMemberCardDailySnapshotsByDateRange).toHaveBeenCalledWith(
      "1001",
      "2026-04-03",
      "2026-04-04",
    );
    expect(store.listCurrentMembers).not.toHaveBeenCalled();
    expect(store.listCurrentMemberCards).not.toHaveBeenCalled();
    expect(result.customerSegments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memberId: "M-1",
          customerIdentityKey: "member:M-1",
          customerDisplayName: "历史会员",
        }),
      ]),
    );
  });
});
