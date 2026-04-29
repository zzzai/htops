import { describe, expect, it } from "vitest";

import {
  listBackfillAndRebuildBizDateRanges,
  parseBackfillAndRebuildArgs,
  renderBackfillAndRebuildDailyMetricsStart,
  renderBackfillAndRebuildDailyMetricsProgress,
} from "./backfill-and-rebuild-script.js";

describe("backfill-and-rebuild script helpers", () => {
  it("defaults to a serving rebuild publication after rebuilding metrics", () => {
    const options = parseBackfillAndRebuildArgs([
      "--start",
      "2026-04-01",
      "--end",
      "2026-04-03",
    ]);

    expect(options).toMatchObject({
      startBizDate: "2026-04-01",
      endBizDate: "2026-04-03",
      skipBackfill: false,
      skipRebuild: false,
      publishMode: "rebuild",
      publicationNotes: "daily-metrics-range-rebuild",
    });
  });

  it("supports opting out of publication and chunking rebuild ranges", () => {
    const options = parseBackfillAndRebuildArgs([
      "--start",
      "2026-04-01",
      "--end",
      "2026-04-10",
      "--org",
      "1001",
      "--org",
      "1002",
      "--publish",
      "skip",
      "--notes",
      "customer-count-fix",
    ]);

    expect(options).toMatchObject({
      orgIds: ["1001", "1002"],
      publishMode: "skip",
      publicationNotes: "customer-count-fix",
    });
    expect(
      listBackfillAndRebuildBizDateRanges("2026-04-01", "2026-04-10", 4),
    ).toEqual([
      { startBizDate: "2026-04-01", endBizDate: "2026-04-04" },
      { startBizDate: "2026-04-05", endBizDate: "2026-04-08" },
      { startBizDate: "2026-04-09", endBizDate: "2026-04-10" },
    ]);
  });

  it("renders daily-metrics rebuild log lines instead of ambiguous report wording", () => {
    expect(renderBackfillAndRebuildDailyMetricsStart(5, 193)).toBe(
      "Rebuilding daily metrics for 5 store(s), 193 business day(s).",
    );
    expect(
      renderBackfillAndRebuildDailyMetricsProgress({
        storeName: "荷塘悦色迎宾店",
        bizDate: "2025-10-06",
        complete: true,
      }),
    ).toBe("荷塘悦色迎宾店 2025-10-06: daily metrics rebuilt (complete)");
  });
});
