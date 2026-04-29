import { describe, expect, it } from "vitest";
import { resolveHetangOpsConfig } from "./config.js";
import { resolveHetangQueryIntent } from "./query-intent.js";
import { executeTechLeaderboardRankingQuery } from "./tech-profile.js";

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
      {
        orgId: "1001",
        storeName: "义乌店",
        rawAliases: ["义乌"],
      },
    ],
  });
}

describe("executeTechLeaderboardRankingQuery", () => {
  it("renders technician ranking from the tech owner module", async () => {
    const config = buildConfig();
    const now = new Date("2026-04-13T10:00:00+08:00");
    const intent = resolveHetangQueryIntent({
      config,
      text: "义乌店昨天技师点钟率排名",
      now,
    });

    expect(intent?.kind).toBe("ranking");
    expect(intent?.rankingTarget).toBe("tech");

    const result = await executeTechLeaderboardRankingQuery({
      runtime: {
        listTechLeaderboard: async () => [
          {
            personCode: "tech-1",
            personName: "技师甲",
            totalClockCount: 12,
            upClockRecordCount: 16,
            pointClockRecordCount: 12,
            pointClockRate: 0.75,
            addClockRecordCount: 4,
            addClockRate: 0.25,
            turnover: 3200,
            commission: 1200,
            commissionRate: 0.375,
            clockEffect: 266.7,
            marketRevenue: 0,
            marketCommission: 0,
          },
          {
            personCode: "tech-2",
            personName: "技师乙",
            totalClockCount: 10,
            upClockRecordCount: 25,
            pointClockRecordCount: 10,
            pointClockRate: 0.4,
            addClockRecordCount: 5,
            addClockRate: 0.2,
            turnover: 2800,
            commission: 980,
            commissionRate: 0.35,
            clockEffect: 280,
            marketRevenue: 0,
            marketCommission: 0,
          },
        ],
      },
      config,
      intent: intent!,
      effectiveOrgIds: ["1001"],
    });

    expect(result).toContain("义乌店");
    expect(result).toContain("点钟率排名");
    expect(result).toContain("1. 技师甲");
    expect(result).toContain("2. 技师乙");
  });
});
