import { describe, expect, it } from "vitest";
import { buildHetangDiagnosticBundle } from "./analysis-diagnostic-service.js";
import type { HetangAnalysisEvidencePack } from "../types.js";

const evidencePack: HetangAnalysisEvidencePack = {
  packVersion: "v1",
  scopeType: "single_store",
  orgIds: ["1001"],
  storeName: "迎宾店",
  question: "迎宾店近7天经营复盘",
  timeFrameLabel: "近7天",
  startBizDate: "2026-04-05",
  endBizDate: "2026-04-11",
  markdown: [
    "证据包",
    "- 门店: 迎宾店",
    "- 周期: 2026-04-05 至 2026-04-11（近7天）",
    "- 问题: 迎宾店近7天经营复盘",
  ].join("\n"),
  facts: {
    latestReport: {
      storeName: "迎宾店",
      complete: true,
      metrics: {
        pointClockRate: 0.42,
        addClockRate: 0.06,
        sleepingMemberRate: 0.2,
        serviceRevenue: 3200,
        totalClockCount: 40,
        clockEffect: 80,
      },
    },
    review7d: {
      revenue7d: 21000,
      totalClocks7d: 280,
      clockEffect7d: 75,
      pointClockRate7d: 0.41,
      addClockRate7d: 0.07,
      sleepingMemberRate: 0.2,
    },
    summary30d: {
      revenue30d: 88000,
      totalClocks30d: 1180,
      clockEffect30d: 74.6,
      pointClockRate30d: 0.46,
      addClockRate30d: 0.31,
      currentStoredBalance: 96000,
    },
    topTechs: [
      {
        personName: "技师甲",
        turnover: 12800,
        pointClockRate: 0.64,
        addClockRate: 0.3,
      },
    ],
  },
};

describe("buildHetangDiagnosticBundle", () => {
  it("derives deterministic diagnostic signals from a single-store evidence pack", () => {
    const bundle = buildHetangDiagnosticBundle(evidencePack);

    expect(bundle.signals.map((signal) => signal.signalId)).toEqual(
      expect.arrayContaining([
        "point_clock_risk",
        "add_clock_weakness",
        "member_silence_risk",
      ]),
    );
    expect(bundle.signals.find((signal) => signal.signalId === "point_clock_risk")).toEqual(
      expect.objectContaining({
        severity: "high",
        recommendedFocus: expect.stringContaining("点钟"),
      }),
    );
  });

  it("derives portfolio-level diagnostic signals from a multi-store evidence pack", () => {
    const bundle = buildHetangDiagnosticBundle({
      packVersion: "v1",
      scopeType: "portfolio",
      orgIds: ["1001", "1002", "1003"],
      storeName: "五店",
      question: "五店近15天整体哪里不对",
      timeFrameLabel: "近15天",
      startBizDate: "2026-04-01",
      endBizDate: "2026-04-15",
      markdown: [
        "证据包",
        "- 范围: 五店",
        "- 周期: 2026-04-01 至 2026-04-15（近15天）",
      ].join("\n"),
      facts: {
        portfolioSnapshots: [
          {
            orgId: "1001",
            storeName: "义乌店",
            latestReport: {
              metrics: {
                serviceRevenue: 4200,
                clockEffect: 101,
                sleepingMemberRate: 0.12,
              },
            },
            summary30d: {
              revenue30d: 98000,
              clockEffect30d: 100,
              sleepingMemberRate: 0.12,
              renewalPressureIndex30d: 0.94,
            },
          },
          {
            orgId: "1002",
            storeName: "华美店",
            latestReport: {
              metrics: {
                serviceRevenue: 2600,
                clockEffect: 68,
                sleepingMemberRate: 0.24,
              },
            },
            summary30d: {
              revenue30d: 64000,
              clockEffect30d: 61,
              sleepingMemberRate: 0.24,
              renewalPressureIndex30d: 1.46,
            },
          },
          {
            orgId: "1003",
            storeName: "锦苑店",
            latestReport: {
              metrics: {
                serviceRevenue: 3500,
                clockEffect: 86,
                sleepingMemberRate: 0.18,
              },
            },
            summary30d: {
              revenue30d: 76000,
              clockEffect30d: 85,
              sleepingMemberRate: 0.18,
              renewalPressureIndex30d: 1.08,
            },
          },
        ],
      },
    });

    expect(bundle.signals.map((signal) => signal.signalId)).toEqual(
      expect.arrayContaining(["portfolio_store_risk", "portfolio_revenue_gap"]),
    );
    expect(bundle.signals.find((signal) => signal.signalId === "portfolio_store_risk")).toEqual(
      expect.objectContaining({
        severity: "high",
        finding: expect.stringContaining("华美店"),
        recommendedFocus: expect.stringContaining("华美店"),
      }),
    );
  });
});
