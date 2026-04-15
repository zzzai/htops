import { resolveSemanticIntent } from "./semantic-intent.js";
import type { RouteEvalFixtureDraft } from "./route-eval-fixture-builder.js";
import type { HetangOpsConfig } from "./types.js";

export type SpecializedQueryAction =
  | "report"
  | "list"
  | "profile"
  | "trend"
  | "anomaly"
  | "ranking";

export type SpecializedQueryUtteranceSample = {
  id: string;
  category: string;
  action: SpecializedQueryAction;
  label: string;
  primary: string;
  similars: string[];
  expectedCapabilityId: string;
  expectedOrgIds?: string[];
};

export type SpecializedQueryRouteEvalFixtureDraft = RouteEvalFixtureDraft & {
  expectedAction: SpecializedQueryAction;
};

export function buildSpecializedQueryRouteEvalFixtures(params: {
  config: HetangOpsConfig;
  now: Date;
  samples: SpecializedQueryUtteranceSample[];
}): SpecializedQueryRouteEvalFixtureDraft[] {
  return params.samples.map((sample) => {
    const intent = resolveSemanticIntent({
      config: params.config,
      text: sample.primary,
      now: params.now,
    });

    if (intent.lane !== "query" || intent.kind !== "query" || intent.action !== sample.action) {
      throw new Error(
        `Specialized query primary utterance must resolve to query:${sample.action}: ${sample.id} -> ${sample.primary} -> ${intent.lane}:${intent.kind}:${intent.action}`,
      );
    }

    if (!intent.capabilityId) {
      throw new Error(
        `Specialized query primary utterance must resolve a capability id: ${sample.id} -> ${sample.primary}`,
      );
    }

    return {
      id: `specialized-query-${sample.id}`,
      rawText: sample.primary,
      expectedLane: "query",
      expectedIntentKind: "query",
      expectedAction: sample.action,
      ...(intent.scope.orgIds.length > 0 ? { expectedOrgIds: intent.scope.orgIds } : {}),
      expectedCapabilityId: intent.capabilityId,
      notes: `${sample.category} / ${sample.label}`,
    };
  });
}
