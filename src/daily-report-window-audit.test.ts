import { describe, expect, it, vi } from "vitest";
import { resolveHetangOpsConfig } from "./config.js";
import {
  auditDailyReportWindow,
  formatDailyReportWindowAuditLine,
} from "./daily-report-window-audit.js";

function buildConfig() {
  return resolveHetangOpsConfig({
    api: {
      appKey: "demo-app-key",
      appSecret: "demo-app-secret",
    },
    database: {
      url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
    },
    stores: [
      { orgId: "1001", storeName: "迎宾店", isActive: true },
      { orgId: "1002", storeName: "义乌店", isActive: true },
      { orgId: "1003", storeName: "停业店", isActive: false },
    ],
  });
}

describe("auditDailyReportWindow", () => {
  it("aggregates a healthy recent window and renders a compact ok line", async () => {
    const reconcileStoreReport = vi.fn(async ({ orgId, bizDate }: { orgId: string; bizDate: string }) => ({
      orgId,
      storeName: orgId === "1001" ? "迎宾店" : "义乌店",
      bizDate,
      summary: {
        auditedMetricCount: 73,
        matchCount: 73,
        freshMismatchCount: 0,
        storedMismatchCount: 0,
        missingStoredCount: 0,
        hasDiffs: false,
        unauditedMetricKeys: ["bizDate", "orgId", "storeName"],
      },
      items: [],
    }));

    const result = await auditDailyReportWindow({
      config: buildConfig(),
      store: {} as never,
      endBizDate: "2026-04-25",
      windowDays: 3,
      reconcileStoreReport: reconcileStoreReport as never,
    });

    expect(reconcileStoreReport).toHaveBeenCalledTimes(6);
    expect(result.summary).toEqual({
      status: "healthy",
      endBizDate: "2026-04-25",
      windowDays: 3,
      dates: ["2026-04-23", "2026-04-24", "2026-04-25"],
      storeCount: 2,
      checkedReports: 6,
      reportsWithFreshMismatch: 0,
      reportsWithStoredMismatch: 0,
      reportsWithOnlyMissingStored: 0,
      maxUnauditedMetricCount: 0,
      unauditedKeys: [],
      sampleIssues: [],
    });
    expect(result.lines).toEqual([
      "2026-04-25 report audit ok - dates=3 stores=2 checked=6 fresh=0 stored=0 missing=0 unaudited=0",
    ]);
    expect(formatDailyReportWindowAuditLine(result.summary)).toBe(
      "2026-04-25 report audit ok - dates=3 stores=2 checked=6 fresh=0 stored=0 missing=0 unaudited=0",
    );
  });

  it("surfaces warning counts and sample issues without storing every diff", async () => {
    const reconcileStoreReport = vi.fn(async ({ orgId, bizDate }: { orgId: string; bizDate: string }) => {
      if (orgId === "1001" && bizDate === "2026-04-25") {
        return {
          orgId,
          storeName: "迎宾店",
          bizDate,
          summary: {
            auditedMetricCount: 73,
            matchCount: 71,
            freshMismatchCount: 0,
            storedMismatchCount: 1,
            missingStoredCount: 0,
            hasDiffs: true,
            unauditedMetricKeys: ["bizDate", "orgId", "storeName", "groupbuy7dCardOpenedRate"],
          },
          items: [
            {
              metricKey: "groupbuy7dCardOpenedRate",
              status: "stored_mismatch",
              expected: 0.2,
              fresh: 0.2,
              stored: 0.1,
            },
          ],
        };
      }

      if (orgId === "1002" && bizDate === "2026-04-24") {
        return {
          orgId,
          storeName: "义乌店",
          bizDate,
          summary: {
            auditedMetricCount: 73,
            matchCount: 70,
            freshMismatchCount: 1,
            storedMismatchCount: 0,
            missingStoredCount: 1,
            hasDiffs: true,
            unauditedMetricKeys: ["bizDate", "orgId", "storeName"],
          },
          items: [
            {
              metricKey: "serviceRevenue",
              status: "fresh_mismatch",
              expected: 100,
              fresh: 98,
              stored: 100,
            },
          ],
        };
      }

      return {
        orgId,
        storeName: orgId === "1001" ? "迎宾店" : "义乌店",
        bizDate,
        summary: {
          auditedMetricCount: 73,
          matchCount: 73,
          freshMismatchCount: 0,
          storedMismatchCount: 0,
          missingStoredCount: 0,
          hasDiffs: false,
          unauditedMetricKeys: ["bizDate", "orgId", "storeName"],
        },
        items: [],
      };
    });

    const result = await auditDailyReportWindow({
      config: buildConfig(),
      store: {} as never,
      endBizDate: "2026-04-25",
      windowDays: 2,
      reconcileStoreReport: reconcileStoreReport as never,
    });

    expect(result.summary.status).toBe("warn");
    expect(result.summary.reportsWithFreshMismatch).toBe(1);
    expect(result.summary.reportsWithStoredMismatch).toBe(1);
    expect(result.summary.reportsWithOnlyMissingStored).toBe(1);
    expect(result.summary.maxUnauditedMetricCount).toBe(1);
    expect(result.summary.unauditedKeys).toEqual(["groupbuy7dCardOpenedRate"]);
    expect(result.summary.sampleIssues).toEqual([
      {
        orgId: "1002",
        storeName: "义乌店",
        bizDate: "2026-04-24",
        topDiffs: [{ metricKey: "serviceRevenue", status: "fresh_mismatch" }],
      },
      {
        orgId: "1001",
        storeName: "迎宾店",
        bizDate: "2026-04-25",
        topDiffs: [{ metricKey: "groupbuy7dCardOpenedRate", status: "stored_mismatch" }],
      },
    ]);
    expect(result.lines).toEqual([
      "2026-04-25 report audit warn - dates=2 stores=2 checked=4 fresh=1 stored=1 missing=1 unaudited=1 sample=义乌店@2026-04-24:serviceRevenue",
    ]);
  });
});
