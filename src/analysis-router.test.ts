import { describe, expect, it } from "vitest";
import { resolveHetangOpsConfig } from "./config.js";
import {
  materializeHetangAnalysisRequest,
  resolveHetangNaturalLanguageRoute,
} from "./analysis-router.js";

function buildConfig() {
  return resolveHetangOpsConfig({
    api: {
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
      {
        orgId: "1002",
        storeName: "迎宾店",
        rawAliases: ["迎宾"],
      },
      {
        orgId: "1003",
        storeName: "荷塘悦色园中园店",
        rawAliases: ["园中园店"],
      },
    ],
  });
}

describe("analysis-router", () => {
  const config = buildConfig();
  const now = new Date("2026-04-13T10:00:00+08:00");

  it("attaches async-analysis capability metadata to single-store deep-review routes", () => {
    const route = resolveHetangNaturalLanguageRoute({
      config,
      content: "义乌店近7天经营复盘",
      now,
    });

    expect(route).toMatchObject({
      action: "analysis",
      capabilityId: "store_review_async_v1",
      request: {
        jobType: "store_review",
        orgId: "1001",
        storeName: "义乌店",
      },
    });
  });

  it("keeps async-analysis capability metadata after binding-scope materialization", () => {
    const route = resolveHetangNaturalLanguageRoute({
      config,
      content: "五店近7天经营复盘",
      now,
    });

    expect(route?.action).toBe("analysis");
    if (!route || route.action !== "analysis") {
      throw new Error("expected analysis route");
    }

    const request = materializeHetangAnalysisRequest({
      config,
      binding: {
        channel: "wecom",
        senderId: "boss-1",
        employeeName: "总部",
        role: "hq",
        isActive: true,
        scopeOrgIds: ["1001", "1002"],
      },
      request: route.request,
    });

    expect(route.capabilityId).toBe("portfolio_store_review_async_v1");
    expect(request.storeName).toBe("2店");
  });

  it("routes safe shortened store aliases into single-store deep-review analysis", () => {
    const route = resolveHetangNaturalLanguageRoute({
      config,
      content: "园中园近7天经营复盘",
      now,
    });

    expect(route).toMatchObject({
      action: "analysis",
      capabilityId: "store_review_async_v1",
      request: {
        jobType: "store_review",
        orgId: "1003",
        storeName: "荷塘悦色园中园店",
      },
    });
  });
});
