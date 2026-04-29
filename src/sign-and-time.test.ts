import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildSignBaseString, createApiSign } from "./sign.js";
import {
  resolveIncrementalWindow,
  resolveOperationalBizDate,
  resolveOperationalBizDateCompletionIso,
  resolveOperationalBizDateFromTimestamp,
  resolveOperationalBizDateWindow,
  resolveOperationalBizDateRangeWindow,
  resolveReportBizDate,
} from "./time.js";

describe("hetang api signing", () => {
  it("sorts params, excludes Sign, and hashes the canonical payload", () => {
    const params = {
      PageSize: 200,
      OrgId: "1001",
      Sign: "ignore-me",
      Etime: "2026-03-29 23:59:59",
      Stime: "2026-03-29 00:00:00",
      PageIndex: 1,
    };

    const base = buildSignBaseString(params, "demo-secret");
    expect(base).toBe(
      "Etime=2026-03-29 23:59:59&OrgId=1001&PageIndex=1&PageSize=200&Stime=2026-03-29 00:00:00&AppSecret=demo-secret",
    );
    expect(createApiSign(params, "demo-secret")).toBe(createHash("md5").update(base).digest("hex"));
  });
});

describe("incremental windows", () => {
  it("uses a seven-day overlap window from the last successful checkpoint", () => {
    const now = new Date("2026-03-30T03:10:00+08:00");
    const window = resolveIncrementalWindow({
      now,
      timeZone: "Asia/Shanghai",
      lastSuccessAt: "2026-03-29T03:10:00+08:00",
      overlapDays: 7,
      initialBackfillDays: 90,
    });

    expect(window.startTime).toBe("2026-03-22 03:10:00");
    expect(window.endTime).toBe("2026-03-30 03:10:00");
  });

  it("falls back to a ninety-day backfill window on first sync", () => {
    const now = new Date("2026-03-30T03:10:00+08:00");
    const window = resolveIncrementalWindow({
      now,
      timeZone: "Asia/Shanghai",
      overlapDays: 7,
      initialBackfillDays: 90,
    });

    expect(window.startTime).toBe("2025-12-30 03:10:00");
    expect(window.endTime).toBe("2026-03-30 03:10:00");
  });

  it("maps overnight source timestamps to the previous operational business day", () => {
    expect(
      resolveOperationalBizDateFromTimestamp("2026-03-31 02:30:00", "Asia/Shanghai", "03:00"),
    ).toBe("2026-03-30");
    expect(
      resolveOperationalBizDateFromTimestamp("2026-03-31 03:00:00", "Asia/Shanghai", "03:00"),
    ).toBe("2026-03-31");
  });

  it("maps the current time to the active operational business day", () => {
    expect(
      resolveOperationalBizDate({
        now: new Date("2026-03-31T02:30:00+08:00"),
        timeZone: "Asia/Shanghai",
        cutoffLocalTime: "03:00",
      }),
    ).toBe("2026-03-30");
    expect(
      resolveOperationalBizDate({
        now: new Date("2026-03-31T08:50:00+08:00"),
        timeZone: "Asia/Shanghai",
        cutoffLocalTime: "03:00",
      }),
    ).toBe("2026-03-31");
  });

  it("builds the daily report for the most recently completed operational day", () => {
    expect(
      resolveReportBizDate({
        now: new Date("2026-03-31T03:10:00+08:00"),
        timeZone: "Asia/Shanghai",
        cutoffLocalTime: "03:00",
      }),
    ).toBe("2026-03-30");
    expect(
      resolveReportBizDate({
        now: new Date("2026-03-31T08:50:00+08:00"),
        timeZone: "Asia/Shanghai",
        cutoffLocalTime: "03:00",
      }),
    ).toBe("2026-03-30");
  });

  it("builds an explicit operational business-day window for historical backfills", () => {
    const window = resolveOperationalBizDateWindow({
      bizDate: "2026-03-01",
      cutoffLocalTime: "03:00",
    });

    expect(window.startTime).toBe("2026-03-01 03:00:00");
    expect(window.endTime).toBe("2026-03-02 02:59:59");
  });

  it("resolves the completion checkpoint for one operational business day in local time", () => {
    expect(
      resolveOperationalBizDateCompletionIso({
        bizDate: "2026-03-31",
        timeZone: "Asia/Shanghai",
        cutoffLocalTime: "03:00",
      }),
    ).toBe("2026-04-01T03:00:00+08:00");
  });

  it("builds a multi-day operational window for weekly backfills", () => {
    const window = resolveOperationalBizDateRangeWindow({
      startBizDate: "2026-03-01",
      endBizDate: "2026-03-07",
      cutoffLocalTime: "03:00",
    });

    expect(window.startTime).toBe("2026-03-01 03:00:00");
    expect(window.endTime).toBe("2026-03-08 02:59:59");
  });
});
