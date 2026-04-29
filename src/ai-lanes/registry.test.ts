import { describe, expect, it } from "vitest";
import { summarizeAiLaneObservability } from "./observability.js";
import {
  ACTIVE_AI_LANE_IDS,
  APPROVED_AI_LANE_IDS,
  RESERVED_AI_LANE_IDS,
  getAiLaneRegistry,
} from "./registry.js";

describe("getAiLaneRegistry", () => {
  it("exposes default contracts for active and reserved ai lanes", () => {
    const registry = getAiLaneRegistry();

    expect(ACTIVE_AI_LANE_IDS).toEqual([
      "general-lite",
      "semantic-fallback",
      "customer-growth-json",
      "cheap-summary",
      "analysis-premium",
      "offline-review",
    ]);
    expect(RESERVED_AI_LANE_IDS).toEqual([
      "hq-premium",
      "world-model-explanation",
      "doctor-review",
    ]);
    expect(APPROVED_AI_LANE_IDS).toEqual([
      ...ACTIVE_AI_LANE_IDS,
      ...RESERVED_AI_LANE_IDS,
    ]);
    expect(Object.keys(registry)).toEqual(APPROVED_AI_LANE_IDS);
    expect(registry["general-lite"]).toMatchObject({
      laneId: "general-lite",
      taskClass: "chat",
      executionMode: "sync",
      ownerModule: "hermes_overrides/sitecustomize.py",
      observabilityLabel: "general-lite",
      defaults: {
        model: "deepseek-v3-2-251201",
        reasoningMode: "off",
        timeoutMs: 2500,
        responseMode: "text",
        fallbackBehavior: "legacy",
      },
    });
    expect(registry["analysis-premium"]).toMatchObject({
      laneId: "analysis-premium",
      taskClass: "analysis",
      executionMode: "async",
      ownerModule: "src/app/analysis-service.ts",
      observabilityLabel: "analysis-premium",
      defaults: {
        model: "gpt-5.4",
        reasoningMode: "high",
        timeoutMs: 90000,
        responseMode: "json",
        fallbackBehavior: "deterministic",
      },
    });
    expect(registry["offline-review"]).toMatchObject({
      laneId: "offline-review",
      taskClass: "review",
      executionMode: "batch",
      ownerModule: "src/ops/doctor.ts",
      observabilityLabel: "offline-review",
      defaults: {
        model: "gpt-5.4",
        reasoningMode: "high",
        timeoutMs: 120000,
        responseMode: "json",
        fallbackBehavior: "deterministic",
      },
    });
    expect(registry["hq-premium"]).toMatchObject({
      laneId: "hq-premium",
      taskClass: "analysis",
      executionMode: "async",
      ownerModule: "src/hq-premium/",
      observabilityLabel: "hq-premium",
      defaults: {
        model: "gpt-5.4",
        reasoningMode: "high",
        timeoutMs: 120000,
        responseMode: "json",
        fallbackBehavior: "deterministic",
      },
    });
    expect(registry["world-model-explanation"]).toMatchObject({
      laneId: "world-model-explanation",
      taskClass: "analysis",
      executionMode: "async",
      ownerModule: "src/world-model-explanation/",
      observabilityLabel: "world-model-explanation",
      defaults: {
        model: "gpt-5.4",
        reasoningMode: "high",
        timeoutMs: 120000,
        responseMode: "json",
        fallbackBehavior: "deterministic",
      },
    });
    expect(registry["doctor-review"]).toMatchObject({
      laneId: "doctor-review",
      taskClass: "review",
      executionMode: "batch",
      ownerModule: "src/doctor-review/",
      observabilityLabel: "doctor-review",
      defaults: {
        model: "gpt-5.4",
        reasoningMode: "high",
        timeoutMs: 120000,
        responseMode: "json",
        fallbackBehavior: "deterministic",
      },
    });
  });

  it("keeps reserved lanes out of default observability unless explicitly requested", () => {
    expect(summarizeAiLaneObservability({ aiLanes: {} }).map((entry) => entry.laneId)).toEqual(
      ACTIVE_AI_LANE_IDS,
    );
    expect(
      summarizeAiLaneObservability(
        { aiLanes: {} },
        {
          includeReserved: true,
        },
      ).map((entry) => entry.laneId),
    ).toEqual(APPROVED_AI_LANE_IDS);
  });
});
