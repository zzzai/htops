import { resolveIntentClarifierDecision } from "./app/intent-clarifier-service.js";
import {
  tryExecuteRuntimeRenderQueryPlane,
  tryExecuteServingQueryPlane,
  type HetangQueryRuntime,
} from "./query-engine-executor.js";
import {
  renderQueryClarification,
  resolveEffectiveOrgIds,
} from "./query-engine-router.js";
import { describeUnsupportedMetricResolution } from "./metric-query.js";
import {
  resolveHetangQueryIntent,
} from "./query-intent.js";
import type { HetangEmployeeBinding, HetangOpsConfig } from "./types.js";

export type HetangQueryExecutionResult = {
  text: string;
  requestedOrgIds: string[];
  effectiveOrgIds: string[];
};

export async function executeHetangQuery(params: {
  runtime: HetangQueryRuntime;
  config: HetangOpsConfig;
  binding: HetangEmployeeBinding;
  text: string;
  now: Date;
}): Promise<HetangQueryExecutionResult> {
  let intent = resolveHetangQueryIntent({
    config: params.config,
    text: params.text,
    now: params.now,
  });
  if (
    (!intent || (intent.routeConfidence && intent.routeConfidence !== "high")) &&
    typeof params.runtime.resolveSemanticFallbackIntent === "function"
  ) {
    const fallback = await params.runtime.resolveSemanticFallbackIntent({
      config: params.config,
      text: params.text,
      now: params.now,
      binding: params.binding,
      ruleIntent: intent,
    });
    if (fallback?.clarificationText) {
      return {
        text: fallback.clarificationText,
        requestedOrgIds: intent?.explicitOrgIds ?? [],
        effectiveOrgIds: [],
      };
    }
    if (fallback?.intent) {
      intent = fallback.intent;
    }
  }
  const clarifierDecision = resolveIntentClarifierDecision({
    config: params.config,
    text: params.text,
    binding: params.binding,
    ruleIntent: intent,
  });
  if (clarifierDecision.kind === "clarify") {
    return {
      text: clarifierDecision.text,
      requestedOrgIds: intent?.explicitOrgIds ?? [],
      effectiveOrgIds: [],
    };
  }
  if (intent?.requiresClarification) {
    return {
      text: renderQueryClarification(intent, params.config),
      requestedOrgIds: intent.explicitOrgIds,
      effectiveOrgIds: [],
    };
  }
  if (!intent) {
    return {
      text: "未识别为可执行的门店数据问题，请补充门店、时间或指标。",
      requestedOrgIds: [],
      effectiveOrgIds: [],
    };
  }

  const unsupportedOnlyText = describeUnsupportedMetricResolution({
    supported: intent.metrics,
    unsupported: intent.unsupportedMetrics,
  });
  if (intent.metrics.length === 0 && unsupportedOnlyText) {
    return {
      text: unsupportedOnlyText,
      requestedOrgIds: intent.explicitOrgIds,
      effectiveOrgIds: intent.explicitOrgIds,
    };
  }

  const scope = resolveEffectiveOrgIds({
    config: params.config,
    binding: params.binding,
    intent,
  });
  if (!scope.ok) {
    return {
      text: scope.text,
      requestedOrgIds: intent.explicitOrgIds,
      effectiveOrgIds: [],
    };
  }

  const servingText = await tryExecuteServingQueryPlane({
    runtime: params.runtime,
    config: params.config,
    binding: params.binding,
    intent,
    effectiveOrgIds: scope.orgIds,
  });
  if (servingText) {
    return {
      text: servingText,
      requestedOrgIds: intent.explicitOrgIds,
      effectiveOrgIds: scope.orgIds,
    };
  }

  const runtimeRenderText = await tryExecuteRuntimeRenderQueryPlane({
    runtime: params.runtime,
    config: params.config,
    binding: params.binding,
    intent,
    effectiveOrgIds: scope.orgIds,
    now: params.now,
  });
  if (runtimeRenderText) {
    return {
      text: runtimeRenderText,
      requestedOrgIds: intent.explicitOrgIds,
      effectiveOrgIds: scope.orgIds,
    };
  }

  return {
    text: "未识别到可执行查询。",
    requestedOrgIds: intent.explicitOrgIds,
    effectiveOrgIds: scope.orgIds,
  };
}
