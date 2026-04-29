import { describe, expect, it, vi } from "vitest";
import { HetangQueryReadService } from "./query-read-service.js";

function buildService(storeOverrides: Record<string, unknown> = {}) {
  const store = {
    listTechUpClockByDateRange: vi.fn(),
    listTechMarketByDateRange: vi.fn(),
    ...storeOverrides,
  };
  const service = new HetangQueryReadService({
    getStore: async () => store as never,
    getCurrentServingVersion: async () => "serving-demo",
    executeCompiledServingQuery: async () => [],
  });
  return {
    service,
    store,
  };
}

describe("HetangQueryReadService", () => {
  it("aggregates tech leaderboard metrics from clock and market rows", async () => {
    const { service, store } = buildService({
      listTechUpClockByDateRange: vi.fn().mockResolvedValue([
        {
          personCode: "T001",
          personName: "小李",
          count: 2,
          clockType: "点钟",
          turnover: 300,
          comm: 120,
          rawJson: JSON.stringify({ AddClockType: 1, ClockType: 2 }),
        },
        {
          personCode: "T001",
          personName: "小李",
          count: 1,
          clockType: "排钟",
          turnover: 120,
          comm: 30,
          rawJson: JSON.stringify({ AddClockType: 0, ClockType: 1 }),
        },
      ]),
      listTechMarketByDateRange: vi.fn().mockResolvedValue([
        {
          personCode: "T001",
          personName: "小李",
          afterDisc: 88,
          commission: 18,
        },
      ]),
    });

    const rows = await service.listTechLeaderboard({
      orgId: "1001",
      startBizDate: "2026-04-01",
      endBizDate: "2026-04-07",
    });

    expect(store.listTechUpClockByDateRange).toHaveBeenCalledWith(
      "1001",
      "2026-04-01",
      "2026-04-07",
    );
    expect(rows).toEqual([
      expect.objectContaining({
        personCode: "T001",
        personName: "小李",
        totalClockCount: 3,
        upClockRecordCount: 2,
        pointClockRecordCount: 1,
        pointClockRate: 0.5,
        addClockRecordCount: 1,
        addClockRate: 0.5,
        turnover: 420,
        commission: 150,
        commissionRate: 150 / 420,
        clockEffect: 140,
        marketRevenue: 88,
        marketCommission: 18,
      }),
    ]);
  });

  it("returns empty arrays when optional mart-derived surfaces are unavailable", async () => {
    const { service } = buildService({
      getMartDerivedStore: vi.fn().mockReturnValue({}),
    });

    await expect(
      service.listMemberReactivationFeatures({
        orgId: "1001",
        bizDate: "2026-04-10",
      }),
    ).resolves.toEqual([]);
    await expect(
      service.listMemberReactivationStrategies({
        orgId: "1001",
        bizDate: "2026-04-10",
      }),
    ).resolves.toEqual([]);
    await expect(
      service.listMemberReactivationQueue({
        orgId: "1001",
        bizDate: "2026-04-10",
      }),
    ).resolves.toEqual([]);
    await expect(
      service.listMemberReactivationFeedback({
        orgId: "1001",
        bizDate: "2026-04-10",
      }),
    ).resolves.toEqual([]);
  });

  it("fails fast when the mart-derived owner getter is missing", async () => {
    const { service } = buildService({
      listCustomerProfile90dByDateRange: vi.fn(),
    });

    await expect(
      service.listCustomerProfile90dByDateRange({
        orgId: "1001",
        startBizDate: "2026-04-01",
        endBizDate: "2026-04-07",
      }),
    ).rejects.toThrow("query-read-service requires store.getMartDerivedStore()");
  });
});
