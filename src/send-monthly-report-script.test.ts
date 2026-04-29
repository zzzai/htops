import { describe, expect, it } from "vitest";

import {
  parseMonthlyReportScriptArgs,
  resolveMonthlyReportNotificationOverride,
} from "./send-monthly-report-script.js";

describe("send monthly report script args", () => {
  it("parses month, dry-run, and notification override flags", () => {
    const args = parseMonthlyReportScriptArgs([
      "--month",
      "2026-03",
      "--target",
      "hetang-hq",
      "--account",
      "corp-1",
      "--thread-id",
      "thread-1",
      "--dry-run",
    ]);

    expect(args).toEqual({
      month: "2026-03",
      channel: "wecom",
      target: "hetang-hq",
      accountId: "corp-1",
      threadId: "thread-1",
      dryRun: true,
    });
    expect(resolveMonthlyReportNotificationOverride(args)).toEqual({
      channel: "wecom",
      target: "hetang-hq",
      accountId: "corp-1",
      threadId: "thread-1",
      enabled: true,
    });
  });

  it("accepts --date as a compatibility alias for --month", () => {
    expect(parseMonthlyReportScriptArgs(["--date", "2026-03"]).month).toBe("2026-03");
  });

  it("rejects non-month values and unknown flags", () => {
    expect(() => parseMonthlyReportScriptArgs(["--month", "2026-03-31"])).toThrow(
      "--month must use YYYY-MM",
    );
    expect(() => parseMonthlyReportScriptArgs(["--unknown"])).toThrow("Unknown argument");
  });
});
