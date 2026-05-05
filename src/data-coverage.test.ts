import { describe, expect, it } from "vitest";
import { assessDateRangeDataCoverage } from "./data-coverage.js";

describe("assessDateRangeDataCoverage", () => {
  it("marks a date range complete when every org has every business date", () => {
    expect(
      assessDateRangeDataCoverage({
        orgIds: ["1001"],
        startBizDate: "2026-04-01",
        endBizDate: "2026-04-03",
        presentDatesByOrg: {
          "1001": ["2026-04-01", "2026-04-02", "2026-04-03"],
        },
        requiredFacts: ["daily_store_metrics"],
      }),
    ).toEqual({
      complete: true,
      coverageRate: 1,
      missingFacts: [],
      missingRanges: [],
      reason: "data_coverage_complete",
    });
  });

  it("collapses missing dates into ranges and reports the coverage rate", () => {
    expect(
      assessDateRangeDataCoverage({
        orgIds: ["1001"],
        startBizDate: "2026-04-01",
        endBizDate: "2026-04-05",
        presentDatesByOrg: {
          "1001": ["2026-04-01", "2026-04-04", "2026-04-05"],
        },
        requiredFacts: ["daily_store_metrics"],
      }),
    ).toEqual({
      complete: false,
      coverageRate: 0.6,
      missingFacts: ["daily_store_metrics"],
      missingRanges: [
        {
          orgId: "1001",
          startBizDate: "2026-04-02",
          endBizDate: "2026-04-03",
        },
      ],
      reason: "data_coverage_incomplete",
    });
  });

  it("tracks gaps independently for each requested org", () => {
    expect(
      assessDateRangeDataCoverage({
        orgIds: ["1001", "1002"],
        startBizDate: "2026-04-01",
        endBizDate: "2026-04-02",
        presentDatesByOrg: {
          "1001": ["2026-04-01", "2026-04-02"],
          "1002": ["2026-04-01"],
        },
        requiredFacts: ["daily_store_metrics"],
      }),
    ).toMatchObject({
      complete: false,
      coverageRate: 0.75,
      missingRanges: [
        {
          orgId: "1002",
          startBizDate: "2026-04-02",
          endBizDate: "2026-04-02",
        },
      ],
    });
  });
});
