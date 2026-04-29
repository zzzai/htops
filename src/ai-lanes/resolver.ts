import type { HetangAiLaneId, HetangOpsConfig } from "../types.js";
import { getAiLaneContract } from "./registry.js";
import type { HetangAiLaneFallbackContract, HetangResolvedAiLaneConfig } from "./types.js";

function assertValidResolvedFallback(
  laneId: HetangAiLaneId,
  fallbackBehavior: HetangResolvedAiLaneConfig["fallbackBehavior"],
  fallbackLaneId: HetangAiLaneId | undefined,
): void {
  if (fallbackBehavior === "lane" && !fallbackLaneId) {
    throw new Error(`AI lane ${laneId} resolved to fallbackBehavior=lane without fallbackLaneId`);
  }
  if (fallbackLaneId === laneId) {
    throw new Error(`AI lane ${laneId} cannot fallback to itself`);
  }
}

export function resolveAiLaneConfig(
  config: Pick<HetangOpsConfig, "aiLanes">,
  laneId: HetangAiLaneId,
): HetangResolvedAiLaneConfig {
  const contract = getAiLaneContract(laneId);
  const override = config.aiLanes[laneId] ?? {};
  const fallbackLaneId = override.fallbackLaneId ?? contract.defaults.fallbackLaneId;
  const resolved: HetangResolvedAiLaneConfig = {
    laneId,
    taskClass: contract.taskClass,
    executionMode: contract.executionMode,
    ownerModule: contract.ownerModule,
    observabilityLabel: contract.observabilityLabel,
    model: override.model ?? contract.defaults.model,
    reasoningMode: override.reasoningMode ?? contract.defaults.reasoningMode,
    timeoutMs: override.timeoutMs ?? contract.defaults.timeoutMs,
    responseMode: override.responseMode ?? contract.defaults.responseMode,
    fallbackBehavior: override.fallbackBehavior ?? contract.defaults.fallbackBehavior,
  };
  const baseUrl = override.baseUrl ?? contract.defaults.baseUrl;
  const apiKey = override.apiKey ?? contract.defaults.apiKey;

  assertValidResolvedFallback(laneId, resolved.fallbackBehavior, fallbackLaneId);

  if (baseUrl) {
    resolved.baseUrl = baseUrl;
  }
  if (apiKey) {
    resolved.apiKey = apiKey;
  }
  if (fallbackLaneId) {
    resolved.fallbackLaneId = fallbackLaneId;
  }
  return resolved;
}

export function resolveAiLaneModel(
  config: Pick<HetangOpsConfig, "aiLanes">,
  laneId: HetangAiLaneId,
): string {
  return resolveAiLaneConfig(config, laneId).model;
}

export function resolveAiLaneFallback(
  config: Pick<HetangOpsConfig, "aiLanes">,
  laneId: HetangAiLaneId,
): HetangAiLaneFallbackContract {
  const resolved = resolveAiLaneConfig(config, laneId);
  return {
    fallbackBehavior: resolved.fallbackBehavior,
    ...(resolved.fallbackLaneId ? { fallbackLaneId: resolved.fallbackLaneId } : {}),
  };
}
