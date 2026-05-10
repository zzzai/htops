import { describe, expect, test } from "vitest";

import {
  buildProjectDataCoverageReport,
  buildProjectDataCoverageProgressState,
  buildStoreDataCoverageGaps,
  countBizDaysInclusive,
  formatProjectDataCoverageDoctorLines,
  formatProjectDataCoverageProgressLine,
  formatProjectDataCoverageReport,
  parseProjectDataCoverageProgressState,
  type ProjectDataCoverageProgressState,
} from "./project-data-coverage.js";
import type { HetangHistoricalCoverageSnapshot } from "./types.js";

function snapshot(params: {
  orgId: string;
  rawFacts: HetangHistoricalCoverageSnapshot["rawFacts"];
  derivedLayers?: Partial<HetangHistoricalCoverageSnapshot["derivedLayers"]>;
}): HetangHistoricalCoverageSnapshot {
  return {
    orgId: params.orgId,
    startBizDate: "2026-04-01",
    endBizDate: "2026-04-03",
    rawFacts: params.rawFacts,
    derivedLayers: {
      factMemberDailySnapshot: { rowCount: 3, dayCount: 3 },
      martCustomerSegments: { rowCount: 3, dayCount: 3 },
      martCustomerConversionCohorts: { rowCount: 3, dayCount: 3 },
      mvCustomerProfile90d: { rowCount: 3, dayCount: 3 },
      ...params.derivedLayers,
    },
  };
}

describe("countBizDaysInclusive", () => {
  test("counts inclusive business date ranges", () => {
    expect(countBizDaysInclusive("2026-04-01", "2026-04-01")).toBe(1);
    expect(countBizDaysInclusive("2026-04-01", "2026-04-03")).toBe(3);
  });
});

describe("buildProjectDataCoverageReport", () => {
  test("summarizes raw and derived coverage status across stores", () => {
    const report = buildProjectDataCoverageReport({
      startBizDate: "2026-04-01",
      endBizDate: "2026-04-03",
      stores: [
        { orgId: "1001", storeName: "一号店" },
        { orgId: "1002", storeName: "二号店" },
      ],
      snapshots: [
        snapshot({
          orgId: "1001",
          rawFacts: {
            "1.2": { rowCount: 3, dayCount: 3 },
            "1.3": { rowCount: 3, dayCount: 3 },
            "1.4": { rowCount: 3, dayCount: 3 },
            "1.6": { rowCount: 3, dayCount: 3 },
            "1.7": { rowCount: 3, dayCount: 3 },
          },
        }),
        snapshot({
          orgId: "1002",
          rawFacts: {
            "1.2": { rowCount: 2, dayCount: 2, firstMissingBizDate: "2026-04-02" },
            "1.3": { rowCount: 3, dayCount: 3 },
            "1.4": { rowCount: 0, dayCount: 0 },
            "1.6": { rowCount: 1, dayCount: 1, firstMissingBizDate: "2026-04-01" },
            "1.7": { rowCount: 3, dayCount: 3 },
          },
          derivedLayers: {
            martCustomerSegments: { rowCount: 2, dayCount: 2, firstMissingBizDate: "2026-04-02" },
          },
        }),
      ],
    });

    expect(report.expectedDays).toBe(3);
    expect(report.overallStatus).toBe("incomplete");
    expect(report.stores[0]).toMatchObject({
      orgId: "1001",
      storeName: "一号店",
      status: "complete",
      rawCoverageRate: 1,
      derivedCoverageRate: 1,
    });
    expect(report.stores[1]).toMatchObject({
      orgId: "1002",
      storeName: "二号店",
      status: "incomplete",
      rawCoverageRate: 0.6,
      derivedCoverageRate: 0.9167,
    });
    expect(report.stores[1]?.rawFacts.find((entry) => entry.key === "1.4")).toMatchObject({
      coverageRate: 0,
      firstMissingBizDate: "2026-04-01",
      status: "missing",
    });
  });
});

describe("formatProjectDataCoverageReport", () => {
  test("renders a concise Chinese coverage report", () => {
    const report = buildProjectDataCoverageReport({
      startBizDate: "2026-04-01",
      endBizDate: "2026-04-03",
      stores: [{ orgId: "1001", storeName: "一号店" }],
      snapshots: [
        snapshot({
          orgId: "1001",
          rawFacts: {
            "1.2": { rowCount: 3, dayCount: 3 },
            "1.3": { rowCount: 2, dayCount: 2, firstMissingBizDate: "2026-04-02" },
            "1.4": { rowCount: 3, dayCount: 3 },
            "1.6": { rowCount: 3, dayCount: 3 },
            "1.7": { rowCount: 3, dayCount: 3 },
          },
        }),
      ],
    });

    expect(formatProjectDataCoverageReport(report)).toContain("数据覆盖率检查：2026-04-01..2026-04-03");
    expect(formatProjectDataCoverageReport(report)).toContain("一号店：incomplete，raw 93.3%，derived 100.0%");
    expect(formatProjectDataCoverageReport(report)).toContain("1.3 66.7%，缺口 2026-04-02");
  });
});

describe("project data coverage doctor surface", () => {
  test("lists store/interface gaps with first missing date and business impact", () => {
    const report = buildProjectDataCoverageReport({
      startBizDate: "2026-04-01",
      endBizDate: "2026-04-03",
      stores: [{ orgId: "1001", storeName: "义乌店" }],
      snapshots: [
        snapshot({
          orgId: "1001",
          rawFacts: {
            "1.2": { rowCount: 3, dayCount: 3 },
            "1.3": { rowCount: 3, dayCount: 3 },
            "1.4": { rowCount: 1, dayCount: 1, firstMissingBizDate: "2026-04-02" },
            "1.6": { rowCount: 3, dayCount: 3 },
            "1.7": { rowCount: 3, dayCount: 3 },
          },
          derivedLayers: {
            martCustomerSegments: { rowCount: 0, dayCount: 0 },
          },
        }),
      ],
    });

    expect(buildStoreDataCoverageGaps(report.stores[0]!)).toEqual([
      expect.objectContaining({
        key: "1.4",
        label: "消费流水",
        coverageRate: 0.3333,
        firstMissingBizDate: "2026-04-02",
        affectsDailyReport: true,
        affectsQuestionAnswering: true,
        affectsActionLoop: true,
      }),
      expect.objectContaining({
        key: "martCustomerSegments",
        label: "顾客分层",
        firstMissingBizDate: "2026-04-01",
        affectsActionLoop: true,
      }),
    ]);

    expect(formatProjectDataCoverageDoctorLines(report)).toEqual([
      "Data coverage 2026-04-01..2026-04-03: incomplete | stores=1 | expected_days=3",
      "Data coverage gap: 义乌店 | 1.4 消费流水 | rate=33.3% | first_missing=2026-04-02 | affects=日报,问答,动作闭环",
      "Data coverage gap: 义乌店 | martCustomerSegments 顾客分层 | rate=0.0% | first_missing=2026-04-01 | affects=问答,动作闭环",
    ]);
  });

  test("tracks whether nightly 1.4 coverage actually progressed", () => {
    const currentReport = buildProjectDataCoverageReport({
      startBizDate: "2026-04-01",
      endBizDate: "2026-04-03",
      stores: [{ orgId: "1001", storeName: "义乌店" }],
      snapshots: [
        snapshot({
          orgId: "1001",
          rawFacts: {
            "1.2": { rowCount: 3, dayCount: 3 },
            "1.3": { rowCount: 3, dayCount: 3 },
            "1.4": { rowCount: 1, dayCount: 1, firstMissingBizDate: "2026-04-02" },
            "1.6": { rowCount: 3, dayCount: 3 },
            "1.7": { rowCount: 3, dayCount: 3 },
          },
        }),
      ],
    });

    const previousState: ProjectDataCoverageProgressState = {
      checkedAt: "2026-04-04T04:00:00.000+08:00",
      startBizDate: "2026-04-01",
      endBizDate: "2026-04-03",
      focusMetricKey: "1.4",
      focusCoveredDays: 1,
      focusExpectedDays: 3,
      focusCoverageRate: 0.3333,
      noProgressNightCount: 1,
      status: "no_progress",
      stores: [
        {
          orgId: "1001",
          storeName: "义乌店",
          dayCount: 1,
          expectedDays: 3,
          coverageRate: 0.3333,
          firstMissingBizDate: "2026-04-02",
        },
      ],
    };

    const state = buildProjectDataCoverageProgressState({
      report: currentReport,
      previousState,
      checkedAt: "2026-04-05T04:00:00.000+08:00",
      focusMetricKey: "1.4",
    });

    expect(state).toMatchObject({
      focusMetricKey: "1.4",
      focusCoveredDays: 1,
      focusExpectedDays: 3,
      focusCoverageRate: 0.3333,
      noProgressNightCount: 2,
      status: "stalled",
    });
    expect(formatProjectDataCoverageProgressLine(state)).toBe(
      "Data coverage progress: 1.4 1/3 days 33.3% | status=stalled | no_progress_nights=2 | check upstream window/card candidates/lock/task order/api failures",
    );
  });

  test("parses persisted progress state defensively", () => {
    expect(
      parseProjectDataCoverageProgressState({
        checkedAt: "2026-04-05T04:00:00.000+08:00",
        startBizDate: "2026-04-01",
        endBizDate: "2026-04-03",
        focusMetricKey: "1.4",
        focusCoveredDays: 1,
        focusExpectedDays: 3,
        focusCoverageRate: 0.3333,
        noProgressNightCount: 2,
        status: "stalled",
        stores: [
          {
            orgId: "1001",
            storeName: "义乌店",
            dayCount: 1,
            expectedDays: 3,
            coverageRate: 0.3333,
          },
        ],
      }),
    ).toMatchObject({
      status: "stalled",
      focusMetricKey: "1.4",
      stores: [{ orgId: "1001", storeName: "义乌店" }],
    });
    expect(parseProjectDataCoverageProgressState({ status: "stalled" })).toBeUndefined();
  });
});
