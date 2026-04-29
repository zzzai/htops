import type { HetangAiLaneObservabilitySummary, HetangOpsConfig } from "../types.js";
import { ACTIVE_AI_LANE_IDS, APPROVED_AI_LANE_IDS } from "./registry.js";
import { resolveAiLaneConfig } from "./resolver.js";

export function summarizeAiLaneObservability(
  config: Pick<HetangOpsConfig, "aiLanes">,
  options?: {
    includeReserved?: boolean;
  },
): HetangAiLaneObservabilitySummary[] {
  const laneIds = options?.includeReserved ? APPROVED_AI_LANE_IDS : ACTIVE_AI_LANE_IDS;
  return laneIds.map((laneId) => {
    const resolved = resolveAiLaneConfig(config, laneId);
    return {
      laneId: resolved.laneId,
      taskClass: resolved.taskClass,
      executionMode: resolved.executionMode,
      ownerModule: resolved.ownerModule,
      observabilityLabel: resolved.observabilityLabel,
      model: resolved.model,
      reasoningMode: resolved.reasoningMode,
      timeoutMs: resolved.timeoutMs,
      responseMode: resolved.responseMode,
      fallbackBehavior: resolved.fallbackBehavior,
      ...(resolved.fallbackLaneId ? { fallbackLaneId: resolved.fallbackLaneId } : {}),
      overrideKeys: Object.keys(config.aiLanes[laneId] ?? {}).sort(),
    };
  });
}
