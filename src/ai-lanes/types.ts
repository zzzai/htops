import type {
  HetangAiLaneFallbackBehavior,
  HetangAiLaneExecutionMode,
  HetangAiLaneId,
  HetangAiLaneObservabilitySummary,
  HetangAiLaneReasoningMode,
  HetangAiLaneResponseMode,
  HetangAiLaneTaskClass,
} from "../types.js";

export type HetangAiLaneDefaultConfig = {
  baseUrl?: string;
  apiKey?: string;
  model: string;
  reasoningMode: HetangAiLaneReasoningMode;
  timeoutMs: number;
  responseMode: HetangAiLaneResponseMode;
  fallbackBehavior: HetangAiLaneFallbackBehavior;
  fallbackLaneId?: HetangAiLaneId;
};

export type HetangAiLaneContract = {
  laneId: HetangAiLaneId;
  taskClass: HetangAiLaneTaskClass;
  executionMode: HetangAiLaneExecutionMode;
  ownerModule: string;
  observabilityLabel: string;
  defaults: HetangAiLaneDefaultConfig;
};

export type HetangResolvedAiLaneConfig = HetangAiLaneDefaultConfig & {
  laneId: HetangAiLaneId;
  taskClass: HetangAiLaneTaskClass;
  executionMode: HetangAiLaneExecutionMode;
  ownerModule: string;
  observabilityLabel: string;
};

export type HetangAiLaneFallbackContract = {
  fallbackBehavior: HetangAiLaneFallbackBehavior;
  fallbackLaneId?: HetangAiLaneId;
};
