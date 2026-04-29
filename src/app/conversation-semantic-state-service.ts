import { resolveConversationSemanticEffectiveText } from "../query-intent.js";
import { resolveMetricIntent } from "../metric-query.js";
import type { HetangSemanticIntent } from "../semantic-intent.js";
import type {
  HetangConversationClarificationReason,
  HetangConversationSemanticStateSnapshot,
  HetangOpsConfig,
} from "../types.js";

type ConversationSemanticStateStore = {
  getConversationSemanticState: (
    sessionId: string,
  ) => Promise<HetangConversationSemanticStateSnapshot | null>;
  upsertConversationSemanticState: (
    snapshot: HetangConversationSemanticStateSnapshot,
  ) => Promise<void>;
  deleteExpiredConversationSemanticState: (nowIso: string) => Promise<void>;
};

type ResolveTurnStateInput = {
  config: HetangOpsConfig;
  channel: string;
  senderId?: string;
  conversationId?: string;
  text: string;
  now: Date;
};

type RecordTurnResultInput = {
  sessionId: string;
  channel: string;
  senderId?: string;
  conversationId?: string;
  rawText: string;
  effectiveText: string;
  semanticIntent: HetangSemanticIntent;
  now: Date;
};

type ResolvedTurnState = {
  sessionId: string;
  snapshot: HetangConversationSemanticStateSnapshot | null;
  effectiveText: string;
  stateCarriedForward: boolean;
  topicSwitchDetected: boolean;
};

const DEFAULT_STATE_TTL_MS = 30 * 60 * 1000;

function mapIntentClarificationReason(
  intent: HetangSemanticIntent,
): HetangConversationClarificationReason | null {
  switch (intent.kind) {
    case "clarify_missing_store":
    case "guidance_customer_missing_store":
      return "missing-store";
    case "clarify_missing_time":
    case "guidance_store_missing_time_range":
    case "guidance_customer_missing_time_range":
    case "guidance_tech_missing_time_range":
    case "guidance_missing_time_range":
      return "missing-time";
    case "guidance_store_missing_metric":
    case "guidance_customer_missing_metric":
    case "guidance_tech_missing_metric":
    case "guidance_missing_metric":
      return "missing-metric";
    case "clarify_mixed_scope":
      return "mixed-scope";
    case "clarify_missing_object_scope":
      return "missing-object-scope";
    default:
      return null;
  }
}

function resolveMissingSlots(reason: HetangConversationClarificationReason | null): string[] {
  switch (reason) {
    case "missing-store":
      return ["store"];
    case "missing-time":
      return ["time"];
    case "missing-metric":
      return ["metric"];
    case "missing-object-scope":
      return ["object-scope"];
    case "mixed-scope":
      return ["scope"];
    default:
      return [];
  }
}

function resolveIntentConfidence(intent: HetangSemanticIntent): number {
  switch (intent.confidence) {
    case "high":
      return 1;
    case "medium":
      return 0.7;
    case "low":
    default:
      return 0.4;
  }
}

function resolveLastFailureClass(intent: HetangSemanticIntent): string | undefined {
  if (intent.clarificationNeeded || intent.action === "clarify") {
    return intent.kind;
  }
  if (intent.kind === "generic_unmatched" || intent.kind.startsWith("unsupported_")) {
    return intent.kind;
  }
  return undefined;
}

function resolveLastMetricKeys(effectiveText: string): string[] {
  return resolveMetricIntent(effectiveText).supported.map((entry) => entry.key);
}

export function buildConversationSemanticSessionId(params: {
  channel: string;
  senderId?: string;
  conversationId?: string;
}): string {
  const stableIdentity =
    params.conversationId?.trim() || params.senderId?.trim() || "anonymous";
  return `${params.channel}:${stableIdentity}`;
}

export class HetangConversationSemanticStateService {
  constructor(
    private readonly params: {
      store: ConversationSemanticStateStore;
      ttlMs?: number;
    },
  ) {}

  async resolveTurnState(input: ResolveTurnStateInput): Promise<ResolvedTurnState> {
    const sessionId = buildConversationSemanticSessionId({
      channel: input.channel,
      senderId: input.senderId,
      conversationId: input.conversationId,
    });
    await this.params.store.deleteExpiredConversationSemanticState(input.now.toISOString());
    const snapshot = await this.params.store.getConversationSemanticState(sessionId);
    const resolution = resolveConversationSemanticEffectiveText({
      config: input.config,
      text: input.text,
      now: input.now,
      semanticState: snapshot,
    });
    return {
      sessionId,
      snapshot,
      effectiveText: resolution.effectiveText,
      stateCarriedForward: resolution.stateCarriedForward,
      topicSwitchDetected: resolution.topicSwitchDetected,
    };
  }

  async recordTurnResult(input: RecordTurnResultInput): Promise<void> {
    const clarificationReason = mapIntentClarificationReason(input.semanticIntent);
    const updatedAt = input.now.toISOString();
    const expiresAt = new Date(
      input.now.getTime() + (this.params.ttlMs ?? DEFAULT_STATE_TTL_MS),
    ).toISOString();
    const snapshot: HetangConversationSemanticStateSnapshot = {
      sessionId: input.sessionId,
      channel: input.channel,
      senderId: input.senderId,
      conversationId: input.conversationId,
      currentGoal: input.semanticIntent.action,
      currentLane: input.semanticIntent.lane,
      lastIntentKind: input.semanticIntent.kind,
      clarificationPending: clarificationReason !== null,
      clarificationReason: clarificationReason ?? undefined,
      anchoredSlots: {
        orgIds: input.semanticIntent.scope.orgIds,
        allStores: input.semanticIntent.scope.allStores,
        object: input.semanticIntent.object,
        action: input.semanticIntent.action,
        timeFrameLabel: input.semanticIntent.timeFrameLabel,
        capabilityId: input.semanticIntent.capabilityId,
        lastCapabilityId: input.semanticIntent.capabilityId,
        lastObject: input.semanticIntent.object,
        lastMetricKeys: resolveLastMetricKeys(input.effectiveText),
        lastFailureClass: resolveLastFailureClass(input.semanticIntent),
      },
      missingSlots: resolveMissingSlots(clarificationReason),
      beliefState:
        clarificationReason === null
          ? {
              lastEffectiveText: input.effectiveText.trim() || input.rawText.trim(),
            }
          : {
              pendingText: input.effectiveText.trim() || input.rawText.trim(),
              lastEffectiveText: input.effectiveText.trim() || input.rawText.trim(),
            },
      desireState: {
        lane: input.semanticIntent.lane,
        object: input.semanticIntent.object,
        action: input.semanticIntent.action,
      },
      intentionState:
        clarificationReason === null
          ? {
              nextAction: input.semanticIntent.lane,
            }
          : {
              nextAction: "clarify",
            },
      lastRouteSnapshot: {
        lane: input.semanticIntent.lane,
        kind: input.semanticIntent.kind,
        action: input.semanticIntent.action,
        capabilityId: input.semanticIntent.capabilityId,
      },
      confidence: resolveIntentConfidence(input.semanticIntent),
      updatedAt,
      expiresAt,
    };
    await this.params.store.upsertConversationSemanticState(snapshot);
  }
}
