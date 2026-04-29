import type { HetangAiLaneId } from "../types.js";
import type { HetangAiLaneContract } from "./types.js";

export const ACTIVE_AI_LANE_IDS: readonly HetangAiLaneId[] = [
  "general-lite",
  "semantic-fallback",
  "customer-growth-json",
  "cheap-summary",
  "analysis-premium",
  "offline-review",
];

export const RESERVED_AI_LANE_IDS: readonly HetangAiLaneId[] = [
  "hq-premium",
  "world-model-explanation",
  "doctor-review",
];

export const APPROVED_AI_LANE_IDS: readonly HetangAiLaneId[] = [
  ...ACTIVE_AI_LANE_IDS,
  ...RESERVED_AI_LANE_IDS,
];

const AI_LANE_REGISTRY: Readonly<Record<HetangAiLaneId, HetangAiLaneContract>> = Object.freeze({
  "general-lite": {
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
  },
  "semantic-fallback": {
    laneId: "semantic-fallback",
    taskClass: "json_extract",
    executionMode: "sync",
    ownerModule: "src/ai-semantic-fallback.ts",
    observabilityLabel: "semantic-fallback",
    defaults: {
      model: "deepseek-v3-2-251201",
      reasoningMode: "off",
      timeoutMs: 3500,
      responseMode: "json",
      fallbackBehavior: "deterministic",
    },
  },
  "customer-growth-json": {
    laneId: "customer-growth-json",
    taskClass: "json_generate",
    executionMode: "sync",
    ownerModule: "src/customer-growth/ai/client.ts",
    observabilityLabel: "customer-growth-json",
    defaults: {
      model: "deepseek-v3-2-251201",
      reasoningMode: "off",
      timeoutMs: 5000,
      responseMode: "json",
      fallbackBehavior: "deterministic",
    },
  },
  "cheap-summary": {
    laneId: "cheap-summary",
    taskClass: "summary",
    executionMode: "sync",
    ownerModule: "src/external-intelligence/llm.ts",
    observabilityLabel: "cheap-summary",
    defaults: {
      model: "doubao-seed-2.0-lite",
      reasoningMode: "off",
      timeoutMs: 5000,
      responseMode: "text",
      fallbackBehavior: "deterministic",
    },
  },
  "analysis-premium": {
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
  },
  "offline-review": {
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
  },
  // Reserved future lane: only for deterministic portfolio evidence and bounded HQ synthesis.
  "hq-premium": {
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
  },
  // Reserved future lane: only for explanations built on deterministic world state.
  "world-model-explanation": {
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
  },
  // Reserved future lane: only for doctor taxonomy/review over deterministic evidence snapshots.
  "doctor-review": {
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
  },
});

export function getAiLaneRegistry(): Readonly<Record<HetangAiLaneId, HetangAiLaneContract>> {
  return AI_LANE_REGISTRY;
}

export function getAiLaneContract(laneId: HetangAiLaneId): HetangAiLaneContract {
  return AI_LANE_REGISTRY[laneId];
}
