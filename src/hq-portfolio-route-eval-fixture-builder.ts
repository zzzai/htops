import { resolveSemanticIntent } from "./semantic-intent.js";
import type { RouteEvalFixtureDraft } from "./route-eval-fixture-builder.js";
import type { HetangOpsConfig } from "./types.js";

export type HqPortfolioUtteranceSample = {
  id: string;
  category: string;
  label: string;
  primary: string;
  similars: string[];
  expectedCapabilityId: string;
  expectedTimeFrameLabel: string;
};

export type HqPortfolioRouteEvalFixtureDraft = RouteEvalFixtureDraft & {
  expectedAction: "ranking";
};

export function buildHqPortfolioRouteEvalFixtures(params: {
  config: HetangOpsConfig;
  now: Date;
  samples: HqPortfolioUtteranceSample[];
}): HqPortfolioRouteEvalFixtureDraft[] {
  return params.samples.map((sample) => {
    const intent = resolveSemanticIntent({
      config: params.config,
      text: sample.primary,
      now: params.now,
    });

    if (
      intent.lane !== "query" ||
      intent.kind !== "query" ||
      intent.object !== "hq" ||
      intent.action !== "ranking"
    ) {
      throw new Error(
        `HQ portfolio primary utterance must resolve to query:ranking:hq: ${sample.id} -> ${sample.primary} -> ${intent.lane}:${intent.kind}:${intent.action}:${intent.object}`,
      );
    }

    if (!intent.capabilityId) {
      throw new Error(
        `HQ portfolio primary utterance must resolve a capability id: ${sample.id} -> ${sample.primary}`,
      );
    }

    return {
      id: `hq-portfolio-${sample.id}`,
      rawText: sample.primary,
      expectedLane: "query",
      expectedIntentKind: "query",
      expectedAction: "ranking",
      expectedCapabilityId: intent.capabilityId,
      notes: `${sample.category} / ${sample.label}`,
    };
  });
}
