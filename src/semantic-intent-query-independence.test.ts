import { describe, expect, it, vi } from "vitest";

const mockResolveHetangNaturalLanguageRoute = vi.fn();

vi.mock("./analysis-router.js", () => ({
  resolveHetangNaturalLanguageRoute: mockResolveHetangNaturalLanguageRoute,
}));

const { resolveHetangOpsConfig } = await import("./config.js");
const { resolveSemanticIntent } = await import("./semantic-intent.js");

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
    sync: { enabled: false },
    reporting: { enabled: false },
  });
}

describe("resolveSemanticIntent query independence from legacy analysis-router", () => {
  const config = buildConfig();
  const now = new Date("2026-04-15T10:00:00+08:00");

  it("still classifies executable query asks into the query lane when legacy route resolution returns null", () => {
    mockResolveHetangNaturalLanguageRoute.mockReturnValue(null);

    const intent = resolveSemanticIntent({
      config,
      text: "义乌店昨天营收多少",
      now,
    });

    expect(intent).toMatchObject({
      lane: "query",
      kind: "query",
      action: "summary",
      capabilityId: "store_day_summary_v1",
      clarificationNeeded: false,
    });
    expect(intent.scope.orgIds).toEqual(["1001"]);
  });

  it("still allows analysis asks to promote into the analysis lane when the legacy route materializes an analysis request", () => {
    mockResolveHetangNaturalLanguageRoute.mockReturnValue({
      action: "analysis",
      capabilityId: "store_review_async_v1",
      request: {
        jobType: "store_review",
        orgId: "1001",
        storeName: "义乌店",
        rawText: "义乌店近30天为什么承压，给我做个深度复盘",
        timeFrameLabel: "近30天",
        startBizDate: "2026-03-16",
        endBizDate: "2026-04-14",
      },
    });

    const intent = resolveSemanticIntent({
      config,
      text: "义乌店近30天为什么承压，给我做个深度复盘",
      now,
    });

    expect(intent).toMatchObject({
      lane: "analysis",
      kind: "analysis",
      action: "analysis",
      capabilityId: "store_review_async_v1",
      clarificationNeeded: false,
      timeFrameLabel: "近30天",
    });
    expect(intent.scope.orgIds).toEqual(["1001"]);
  });
});
