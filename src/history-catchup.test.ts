import { describe, expect, it } from "vitest";
import { resolveHistoryCatchupRange, resolveHistoryCatchupOrgIds } from "./history-catchup.js";
import { resolveHetangOpsConfig } from "./config.js";

describe("history-catchup", () => {
  it("defaults to the most recent 180-day operational window ending at the last completed biz date", () => {
    const range = resolveHistoryCatchupRange({
      now: new Date("2026-04-08T04:05:00+08:00"),
      timeZone: "Asia/Shanghai",
      cutoffLocalTime: "03:00",
      historyBackfillDays: 180,
    });

    expect(range).toEqual({
      startBizDate: "2025-10-10",
      endBizDate: "2026-04-07",
    });
  });

  it("uses active stores by default and keeps explicit org filters stable", () => {
    const config = resolveHetangOpsConfig({
      api: {
        appKey: "demo-app-key",
        appSecret: "demo-app-secret",
      },
      database: {
        url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
      },
      stores: [
        {
          orgId: "1001",
          storeName: "一号店",
        },
        {
          orgId: "1002",
          storeName: "二号店",
          isActive: false,
        },
        {
          orgId: "1003",
          storeName: "三号店",
        },
      ],
    });

    expect(resolveHistoryCatchupOrgIds(config)).toEqual(["1001", "1003"]);
    expect(resolveHistoryCatchupOrgIds(config, ["1003"])).toEqual(["1003"]);
  });
});
