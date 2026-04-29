import {
  shouldPreferRuntimeRenderBeforeServing,
  tryExecuteRuntimeRenderQueryPlane,
  tryExecuteServingQueryPlane,
  type HetangQueryRuntime,
} from "./query-engine-executor.js";
import {
  resolveEffectiveOrgIds,
  resolveAccessScopeKind,
} from "./query-engine-router.js";
import { describeUnsupportedMetricResolution } from "./metric-query.js";
import { resolveHetangQueryEntry, type HetangQueryEntryResolution } from "./query-entry-adapter.js";
import { buildQueryPlanFromIntent } from "./query-plan.js";
import type { HetangEmployeeBinding, HetangOpsConfig } from "./types.js";

export type HetangQueryExecutionResult = {
  text: string;
  requestedOrgIds: string[];
  effectiveOrgIds: string[];
  entry?: {
    source: HetangQueryEntryResolution["source"];
    reason: string;
  };
};

type SemanticAuditVersionContext = {
  deployMarker?: string;
  servingVersion?: string;
};

function resolveEntryClarificationReason(reason: string): string | undefined {
  switch (reason) {
    case "missing-store":
    case "missing-time":
    case "missing-metric":
    case "mixed-scope":
    case "missing-object-scope":
      return reason;
    default:
      return undefined;
  }
}

async function recordSemanticExecutionAuditSafe(params: {
  runtime: HetangQueryRuntime;
  record: Parameters<NonNullable<HetangQueryRuntime["recordSemanticExecutionAudit"]>>[0];
}): Promise<void> {
  try {
    await params.runtime.recordSemanticExecutionAudit?.(params.record);
  } catch {
    // Telemetry must never block the deterministic query path.
  }
}

async function resolveSemanticAuditVersionContext(
  runtime: Pick<HetangQueryRuntime, "getCurrentServingVersion">,
): Promise<SemanticAuditVersionContext> {
  if (typeof runtime.getCurrentServingVersion !== "function") {
    return {};
  }
  try {
    const servingVersion = await runtime.getCurrentServingVersion();
    if (typeof servingVersion !== "string" || servingVersion.trim().length === 0) {
      return {};
    }
    return {
      servingVersion,
      deployMarker: `serving:${servingVersion}`,
    };
  } catch {
    return {};
  }
}

function resolveRouteUpgradeKind(params: {
  intentKind: string;
  supportedMetricCount: number;
  hasAnalysisLens: boolean;
}): string | undefined {
  if (!params.hasAnalysisLens || params.supportedMetricCount <= 0) {
    return undefined;
  }
  switch (params.intentKind) {
    case "advice":
      return "metric_to_advice";
    case "report":
      return "metric_to_report";
    case "hq_portfolio":
      return "metric_to_hq_portfolio";
    default:
      return undefined;
  }
}

export async function executeHetangQuery(params: {
  runtime: HetangQueryRuntime;
  config: HetangOpsConfig;
  binding: HetangEmployeeBinding;
  text: string;
  now: Date;
}): Promise<HetangQueryExecutionResult> {
  const startedAtMs = Date.now();
  const semanticAuditVersion = await resolveSemanticAuditVersionContext(params.runtime);
  const entry = await resolveHetangQueryEntry({
    runtime: params.runtime,
    config: params.config,
    binding: params.binding,
    text: params.text,
    now: params.now,
  });
  const entryMetadata = {
    source: entry.source,
    reason: entry.reason,
  } as const;
  if (entry.kind === "clarify") {
    await recordSemanticExecutionAuditSafe({
      runtime: params.runtime,
      record: {
        entry: "query",
        entrySource: entry.source,
        channel: params.binding.channel,
        senderId: params.binding.senderId,
        rawText: params.text,
        clarificationNeeded: true,
        clarificationReason: resolveEntryClarificationReason(entry.reason),
        ...semanticAuditVersion,
        success: false,
        durationMs: Date.now() - startedAtMs,
        occurredAt: params.now.toISOString(),
      },
    });
    return {
      text: entry.text,
      requestedOrgIds: [],
      effectiveOrgIds: [],
      entry: entryMetadata,
    };
  }
  if (entry.kind === "unresolved") {
    await recordSemanticExecutionAuditSafe({
      runtime: params.runtime,
      record: {
        entry: "query",
        entrySource: entry.source,
        channel: params.binding.channel,
        senderId: params.binding.senderId,
        rawText: params.text,
        ...semanticAuditVersion,
        success: false,
        failureClass: "entry_unresolved",
        durationMs: Date.now() - startedAtMs,
        occurredAt: params.now.toISOString(),
      },
    });
    return {
      text: "未识别为可执行的门店数据问题，请补充门店、时间或指标。",
      requestedOrgIds: [],
      effectiveOrgIds: [],
      entry: entryMetadata,
    };
  }
  const intent = entry.intent;

  const unsupportedOnlyText = describeUnsupportedMetricResolution({
    supported: intent.metrics,
    unsupported: intent.unsupportedMetrics,
  });
  if (intent.metrics.length === 0 && unsupportedOnlyText) {
    await recordSemanticExecutionAuditSafe({
      runtime: params.runtime,
      record: {
        entry: "query",
        entrySource: entry.source,
        channel: params.binding.channel,
        senderId: params.binding.senderId,
        rawText: params.text,
        semanticLane: "query",
        intentKind: intent.kind,
        ...semanticAuditVersion,
        success: true,
        executed: false,
        durationMs: Date.now() - startedAtMs,
        occurredAt: params.now.toISOString(),
      },
    });
    return {
      text: unsupportedOnlyText,
      requestedOrgIds: intent.explicitOrgIds,
      effectiveOrgIds: intent.explicitOrgIds,
      entry: entryMetadata,
    };
  }

  const scope = resolveEffectiveOrgIds({
    config: params.config,
    binding: params.binding,
    intent,
  });
  if (!scope.ok) {
    await recordSemanticExecutionAuditSafe({
      runtime: params.runtime,
      record: {
        entry: "query",
        entrySource: entry.source,
        channel: params.binding.channel,
        senderId: params.binding.senderId,
        rawText: params.text,
        semanticLane: "query",
        intentKind: intent.kind,
        ...semanticAuditVersion,
        success: false,
        failureClass: "execution_failed",
        durationMs: Date.now() - startedAtMs,
        occurredAt: params.now.toISOString(),
      },
    });
    return {
      text: scope.text,
      requestedOrgIds: intent.explicitOrgIds,
      effectiveOrgIds: [],
      entry: entryMetadata,
    };
  }

  const plan = buildQueryPlanFromIntent({
    intent,
    effectiveOrgIds: scope.orgIds,
    accessScopeKind: resolveAccessScopeKind(params.binding),
  });
  const analysisTelemetry = plan.analysis
    ? {
        analysisFrameworkId: plan.analysis.framework_id,
        analysisPersonaId: plan.analysis.persona_id,
        routeUpgradeKind: resolveRouteUpgradeKind({
          intentKind: intent.kind,
          supportedMetricCount: intent.metrics.length,
          hasAnalysisLens: true,
        }),
      }
    : {};

  if (!shouldPreferRuntimeRenderBeforeServing(intent)) {
    const servingText = await tryExecuteServingQueryPlane({
      runtime: params.runtime,
      config: params.config,
      binding: params.binding,
      intent,
      effectiveOrgIds: scope.orgIds,
      servingVersionOverride: semanticAuditVersion.servingVersion,
    });
    if (servingText) {
      await recordSemanticExecutionAuditSafe({
        runtime: params.runtime,
        record: {
          entry: "query",
          entrySource: entry.source,
          channel: params.binding.channel,
          senderId: params.binding.senderId,
          rawText: params.text,
          semanticLane: "query",
          intentKind: intent.kind,
          ...semanticAuditVersion,
          ...analysisTelemetry,
          success: true,
          executed: true,
          durationMs: Date.now() - startedAtMs,
          occurredAt: params.now.toISOString(),
        },
      });
      return {
        text: servingText,
        requestedOrgIds: intent.explicitOrgIds,
        effectiveOrgIds: scope.orgIds,
        entry: entryMetadata,
      };
    }
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
    await recordSemanticExecutionAuditSafe({
      runtime: params.runtime,
      record: {
        entry: "query",
        entrySource: entry.source,
        channel: params.binding.channel,
        senderId: params.binding.senderId,
        rawText: params.text,
        semanticLane: "query",
        intentKind: intent.kind,
        ...semanticAuditVersion,
        ...analysisTelemetry,
        success: true,
        executed: true,
        durationMs: Date.now() - startedAtMs,
        occurredAt: params.now.toISOString(),
      },
    });
    return {
      text: runtimeRenderText,
      requestedOrgIds: intent.explicitOrgIds,
      effectiveOrgIds: scope.orgIds,
      entry: entryMetadata,
    };
  }

  await recordSemanticExecutionAuditSafe({
    runtime: params.runtime,
    record: {
      entry: "query",
      entrySource: entry.source,
      channel: params.binding.channel,
      senderId: params.binding.senderId,
      rawText: params.text,
      semanticLane: "query",
      intentKind: intent.kind,
      ...semanticAuditVersion,
      ...analysisTelemetry,
      success: false,
      failureClass: "semantic_failure",
      durationMs: Date.now() - startedAtMs,
      occurredAt: params.now.toISOString(),
    },
  });
  return {
    text: "未识别到可执行查询。",
    requestedOrgIds: intent.explicitOrgIds,
    effectiveOrgIds: scope.orgIds,
    entry: entryMetadata,
  };
}
