import { describe, expect, it, vi } from "vitest";

import { runLocalCustomerHistoryCatchup } from "./rebuild-customer-history-local-script.js";

describe("runLocalCustomerHistoryCatchup", () => {
  it("rebuilds reactivation queue after features and strategies", async () => {
    const rebuildMemberDailySnapshotsForDateRange = vi.fn().mockResolvedValue(1);
    const rebuildCustomerIntelligenceForDateRange = vi.fn().mockResolvedValue(1);
    const rebuildMemberReactivationFeaturesForDateRange = vi.fn().mockResolvedValue(1);
    const rebuildMemberReactivationStrategiesForDateRange = vi.fn().mockResolvedValue(1);
    const rebuildMemberReactivationQueueForDateRange = vi.fn().mockResolvedValue(1);
    const forceRebuildAnalyticsViews = vi.fn().mockResolvedValue(undefined);
    const logs: string[] = [];

    await runLocalCustomerHistoryCatchup({
      store: {
        forceRebuildAnalyticsViews,
      } as never,
      stores: [
        {
          orgId: "627149864218629",
          storeName: "荷塘悦色迎宾店",
        },
      ],
      orgIds: ["627149864218629"],
      range: {
        startBizDate: "2026-04-09",
        endBizDate: "2026-04-09",
      },
      intelligenceChunkDays: 14,
      log: (line) => logs.push(line),
      rebuildMemberDailySnapshotsForDateRange,
      rebuildCustomerIntelligenceForDateRange,
      rebuildMemberReactivationFeaturesForDateRange,
      rebuildMemberReactivationStrategiesForDateRange,
      rebuildMemberReactivationQueueForDateRange,
    });

    expect(rebuildMemberDailySnapshotsForDateRange).toHaveBeenCalledTimes(1);
    expect(rebuildCustomerIntelligenceForDateRange).toHaveBeenCalledWith({
      store: expect.anything(),
      orgId: "627149864218629",
      startBizDate: "2026-04-09",
      endBizDate: "2026-04-09",
      refreshViews: false,
      chunkDays: 14,
      storeConfig: {
        orgId: "627149864218629",
        storeName: "荷塘悦色迎宾店",
      },
    });
    expect(rebuildMemberReactivationFeaturesForDateRange).toHaveBeenCalledTimes(1);
    expect(rebuildMemberReactivationStrategiesForDateRange).toHaveBeenCalledTimes(1);
    expect(rebuildMemberReactivationQueueForDateRange).toHaveBeenCalledWith({
      store: expect.anything(),
      orgId: "627149864218629",
      startBizDate: "2026-04-09",
      endBizDate: "2026-04-09",
      refreshViews: false,
      storeConfig: {
        orgId: "627149864218629",
        storeName: "荷塘悦色迎宾店",
      },
    });
    expect(forceRebuildAnalyticsViews).toHaveBeenCalledTimes(1);
    expect(logs).toContain("[荷塘悦色迎宾店] member reactivation queue rebuilt for 1 days");
    expect(logs.at(-1)).toBe("Local customer history catchup complete");
  });
});
