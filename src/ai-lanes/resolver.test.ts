import { describe, expect, it } from "vitest";
import type { HetangAiLaneRegistryConfig, HetangOpsConfig } from "../types.js";
import { resolveAiLaneConfig, resolveAiLaneFallback, resolveAiLaneModel } from "./resolver.js";

function buildConfig(aiLanes: HetangAiLaneRegistryConfig = {}): Pick<HetangOpsConfig, "aiLanes"> {
  return { aiLanes };
}

describe("resolveAiLaneConfig", () => {
  it("merges registry defaults with htops ai lane overrides", () => {
    const config = buildConfig({
      "analysis-premium": {
        timeoutMs: 120000,
        responseMode: "json",
      },
    });

    expect(resolveAiLaneConfig(config, "analysis-premium")).toEqual({
      laneId: "analysis-premium",
      taskClass: "analysis",
      executionMode: "async",
      ownerModule: "src/app/analysis-service.ts",
      observabilityLabel: "analysis-premium",
      model: "gpt-5.4",
      reasoningMode: "high",
      timeoutMs: 120000,
      responseMode: "json",
      fallbackBehavior: "deterministic",
    });
    expect(resolveAiLaneModel(config, "analysis-premium")).toBe("gpt-5.4");
  });

  it("keeps unrelated lanes decoupled when one lane is overridden", () => {
    const config = buildConfig({
      "customer-growth-json": {
        model: "deepseek-v3-2-251201-hotfix",
      },
    });

    expect(resolveAiLaneModel(config, "customer-growth-json")).toBe(
      "deepseek-v3-2-251201-hotfix",
    );
    expect(resolveAiLaneModel(config, "cheap-summary")).toBe("doubao-seed-2.0-lite");
  });

  it("returns resolved lane fallback contracts", () => {
    const config = buildConfig({
      "customer-growth-json": {
        fallbackBehavior: "lane",
        fallbackLaneId: "cheap-summary",
      },
    });

    expect(resolveAiLaneFallback(config, "customer-growth-json")).toEqual({
      fallbackBehavior: "lane",
      fallbackLaneId: "cheap-summary",
    });
    expect(resolveAiLaneConfig(config, "customer-growth-json")).toMatchObject({
      model: "deepseek-v3-2-251201",
      reasoningMode: "off",
      responseMode: "json",
      fallbackBehavior: "lane",
      fallbackLaneId: "cheap-summary",
    });
  });
});
