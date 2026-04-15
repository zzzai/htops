import { resolveSemanticIntent } from "./semantic-intent.js";
import type { RouteEvalFixtureDraft } from "./route-eval-fixture-builder.js";
import type { HetangEmployeeBinding, HetangOpsConfig } from "./types.js";

export type MetricUserUtteranceSample = {
  metricKey: string;
  label: string;
  category: string;
  primary: string;
  similars: string[];
  notes?: string;
};

function resolveConfiguredStoreTokens(config: HetangOpsConfig): string[] {
  return config.stores
    .flatMap((store) => [store.storeName, ...(store.rawAliases ?? [])])
    .filter((token): token is string => Boolean(token))
    .sort((left, right) => right.length - left.length);
}

function stripLeadingStoreMention(text: string, config: HetangOpsConfig): string {
  const trimmed = text.trim();
  for (const token of resolveConfiguredStoreTokens(config)) {
    if (trimmed.startsWith(token)) {
      return trimmed.slice(token.length).trim();
    }
  }
  return trimmed;
}

export function buildMetricRouteEvalFixtures(params: {
  config: HetangOpsConfig;
  now: Date;
  samples: MetricUserUtteranceSample[];
}): RouteEvalFixtureDraft[] {
  return params.samples.map((sample) => {
    const intent = resolveSemanticIntent({
      config: params.config,
      text: sample.primary,
      now: params.now,
    });

    if (intent.lane !== "query" || intent.kind !== "query") {
      throw new Error(
        `Primary metric utterance must resolve to query lane: ${sample.metricKey} -> ${sample.primary} -> ${intent.lane}:${intent.kind}`,
      );
    }

    if (intent.scope.orgIds.length === 0) {
      throw new Error(
        `Primary metric utterance must resolve a concrete store scope: ${sample.metricKey} -> ${sample.primary}`,
      );
    }

    if (!intent.capabilityId) {
      throw new Error(
        `Primary metric utterance must resolve a capability id: ${sample.metricKey} -> ${sample.primary}`,
      );
    }

    return {
      id: `metric-${sample.metricKey}`,
      rawText: sample.primary,
      expectedLane: "query",
      expectedIntentKind: "query",
      expectedOrgIds: intent.scope.orgIds,
      expectedCapabilityId: intent.capabilityId,
      notes: `${sample.category} / ${sample.label}`,
    };
  });
}

export function buildBoundMetricRouteEvalFixtures(params: {
  config: HetangOpsConfig;
  now: Date;
  binding: HetangEmployeeBinding;
  samples: MetricUserUtteranceSample[];
}): RouteEvalFixtureDraft[] {
  return params.samples.map((sample) => {
    const rawText = stripLeadingStoreMention(sample.primary, params.config);
    const intent = resolveSemanticIntent({
      config: params.config,
      text: rawText,
      now: params.now,
      binding: params.binding,
      defaultOrgId: params.binding.orgId,
    });

    if (intent.lane !== "query" || intent.kind !== "query") {
      throw new Error(
        `Bound metric utterance must resolve to query lane: ${sample.metricKey} -> ${rawText} -> ${intent.lane}:${intent.kind}`,
      );
    }

    if (intent.scope.orgIds.length === 0) {
      throw new Error(
        `Bound metric utterance must resolve a concrete store scope: ${sample.metricKey} -> ${rawText}`,
      );
    }

    if (!intent.capabilityId) {
      throw new Error(
        `Bound metric utterance must resolve a capability id: ${sample.metricKey} -> ${rawText}`,
      );
    }

    return {
      id: `metric-bound-${sample.metricKey}`,
      rawText,
      expectedLane: "query",
      expectedIntentKind: "query",
      expectedOrgIds: intent.scope.orgIds,
      expectedCapabilityId: intent.capabilityId,
      notes: `single-store binding / ${sample.category} / ${sample.label}`,
      bindingRequired: "single-store",
    };
  });
}
