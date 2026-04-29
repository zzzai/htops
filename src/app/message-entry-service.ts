import { runHetangCommand, runHetangTypedQuery } from "../command.js";
import {
  createHetangInboundClaimHandler,
  executeSemanticFrontDoorAction,
  resolveDefaultNaturalLanguageOrgId,
  resolveInboundEmployeeBinding,
  resolveLegacyInboundRouteSnapshot,
  type HetangSemanticMetaQueryProbeOutcome,
  type HetangInboundReplySender,
} from "../inbound.js";
import { buildCapabilityGraphSnapshot } from "../capability-graph.js";
import { CONTROL_PLANE_CONTRACT_VERSION } from "../schedule.js";
import type { HetangConversationSemanticStateService } from "./conversation-semantic-state-service.js";
import type { HetangSemanticQualityService } from "./semantic-quality-service.js";
import type { HetangXiaohongshuLinkService } from "./xiaohongshu-link-service.js";
import {
  HETANG_TOOLS_CONTRACT_VERSION,
  listHetangToolDescriptors,
} from "../tools/contracts.js";
import {
  formatHetangRouteSnapshot,
  resolveSemanticIntent,
  type HetangRouteSnapshot,
  type HetangSemanticIntent,
} from "../semantic-intent.js";
import {
  buildCorrectionInterruptKey,
  createCorrectionInterruptService,
} from "./correction-interrupt-service.js";
import {
  resolveReplyGuardDecision,
  shouldRunReplyGuard,
} from "./reply-guard-service.js";
import type {
  HetangInboundMessageAuditRecord,
  HetangLogger,
  HetangNotificationTarget,
  HetangOpsConfig,
} from "../types.js";
import type {
  HetangBridgeCapabilities,
  HetangBridgeCommandRequest,
  HetangBridgeInboundRequest,
  HetangBridgeResponse,
} from "../bridge/contracts.js";

type HetangCommandRuntime = Parameters<typeof runHetangCommand>[0]["runtime"];
type HetangInboundHandler = ReturnType<typeof createHetangInboundClaimHandler>;

type CapturedReply = {
  channel: string;
  target: string;
  accountId?: string;
  threadId?: string;
  message: string;
};

type CapturedInboundPass = {
  current: CapturedReply | null;
  route: HetangRouteSnapshot | null;
  metaQueryProbeOutcome: HetangSemanticMetaQueryProbeOutcome | null;
};

type RoutingMode = "legacy" | "shadow" | "semantic";
type FrontDoorDecision =
  | "group_noop"
  | "semantic_meta_early_stop"
  | "semantic_query_direct"
  | "semantic_analysis_direct"
  | "legacy_pass"
  | "legacy_noop";

type FrontDoorPrechecks = {
  groupNoop: boolean;
  routingControlsResolved: boolean;
  bindingLookupCompleted: boolean;
  bindingPresent: boolean;
  semanticIntentResolved: boolean;
  legacyCompareRouteResolved: boolean;
  effectiveRoutingMode: RoutingMode;
};

type ConversationSemanticTurnState = {
  sessionId: string;
  snapshot: Awaited<
    ReturnType<HetangConversationSemanticStateService["resolveTurnState"]>
  >["snapshot"];
  effectiveText: string;
  stateCarriedForward: boolean;
  topicSwitchDetected: boolean;
};

async function resolveSemanticAuditVersionContext(
  runtime: Pick<HetangCommandRuntime, "getCurrentServingVersion">,
): Promise<{ deployMarker?: string; servingVersion?: string }> {
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

const ROUTING_MODE_CACHE_TTL_MS = 5_000;
const DEFAULT_INBOUND_ACCEPT_AFTER_MS = 2_000;
const DEFAULT_INBOUND_ACCEPT_TEXT = "收到，在处理。";
const DEFAULT_DEFERRED_INBOUND_FAILURE_TEXT = "刚才那条问题处理中断了，请稍后再试。";

type DeferredNotificationSender = (params: {
  notification: HetangNotificationTarget;
  message: string;
}) => Promise<void>;

type XiaohongshuLinkServiceLike = Pick<
  HetangXiaohongshuLinkService,
  "canHandleText" | "buildReplyForText"
>;

function parseControlTowerSenderAllowlist(value: string | number | boolean | undefined): string[] {
  if (typeof value !== "string") {
    return [];
  }
  return Array.from(
    new Set(
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    ),
  );
}

function resolveCommandArgs(request: HetangBridgeCommandRequest): string {
  const explicitArgs = request.args?.trim();
  if (explicitArgs) {
    return explicitArgs;
  }
  const commandName = request.command_name?.trim() || "hetang";
  const commandPrefix = new RegExp(`^/?${commandName}\\b`, "iu");
  return request.content.replace(commandPrefix, "").trim();
}

function buildImmediateResponse(params: {
  handled: boolean;
  entry: "command" | "inbound";
  text?: string;
}): HetangBridgeResponse {
  return {
    ok: true,
    handled: params.handled,
    reply: params.text
      ? {
          mode: "immediate",
          text: params.text,
        }
      : {
          mode: "noop",
        },
    job: null,
    audit: {
      entry: params.entry,
    },
  };
}

function buildInboundNoopResponse(handled: boolean): HetangBridgeResponse {
  return {
    ok: true,
    handled,
    reply: {
      mode: "noop",
    },
    job: null,
    audit: {
      entry: "inbound",
    },
  };
}

function buildAcceptedResponse(params: {
  handled: boolean;
  entry: "command" | "inbound";
  text: string;
}): HetangBridgeResponse {
  return {
    ok: true,
    handled: params.handled,
    reply: {
      mode: "accepted",
      text: params.text,
    },
    job: null,
    audit: {
      entry: params.entry,
    },
  };
}

function resolveDeferredInboundNotification(
  request: HetangBridgeInboundRequest,
): HetangNotificationTarget | null {
  const target = request.conversation_id?.trim() || request.sender_id?.trim();
  if (!target) {
    return null;
  }
  return {
    channel: request.channel,
    target,
    accountId: request.account_id,
    threadId: request.thread_id,
    enabled: true,
  };
}

function resolveDeferredInboundFinalText(response: HetangBridgeResponse): string | null {
  if (response.reply.mode !== "immediate") {
    return null;
  }
  const text = response.reply.text?.trim();
  return text ? text : null;
}

function summarizeDeferredInboundText(text: string): { length: number; excerpt: string } {
  const normalized = text.replace(/\s+/gu, " ").trim();
  return {
    length: normalized.length,
    excerpt: normalized.length > 120 ? `${normalized.slice(0, 120)}…` : normalized,
  };
}

function mergeRouteSnapshot(
  primary: HetangRouteSnapshot | null,
  fallback: HetangRouteSnapshot | null,
): HetangRouteSnapshot | null {
  if (!primary) {
    return fallback;
  }
  if (!fallback) {
    return primary;
  }
  return {
    lane: primary.lane,
    kind: primary.kind,
    action: primary.action ?? fallback.action,
    capabilityId: primary.capabilityId ?? fallback.capabilityId,
  };
}

function resolveRouteDriftTags(params: {
  legacyRoute: HetangRouteSnapshot | null;
  semanticIntent: HetangSemanticIntent;
}): string[] {
  const routeChanged =
    formatHetangRouteSnapshot(params.legacyRoute) !== formatHetangRouteSnapshot(params.semanticIntent);
  const capabilityChanged =
    (params.legacyRoute?.capabilityId ?? null) !== (params.semanticIntent.capabilityId ?? null);
  if (
    (routeChanged || capabilityChanged) &&
    params.semanticIntent.lane === "query" &&
    params.semanticIntent.object === "hq" &&
    params.semanticIntent.confidence === "high" &&
    params.semanticIntent.scope.allStores
  ) {
    return ["hq_portfolio_high_confidence_route_drift"];
  }
  return [];
}

function resolveSemanticClarificationReason(
  intent: HetangSemanticIntent | null,
): string | undefined {
  switch (intent?.kind) {
    case "clarify_missing_store":
      return "missing-store";
    case "clarify_missing_time":
      return "missing-time";
    case "clarify_mixed_scope":
      return "mixed-scope";
    case "clarify_missing_object_scope":
      return "missing-object-scope";
    default:
      return undefined;
  }
}

function resolveSemanticEntrySuccess(params: {
  intent: HetangSemanticIntent | null;
  text?: string;
}): boolean {
  if (!params.text || !params.intent) {
    return false;
  }
  if (params.intent.clarificationNeeded) {
    return false;
  }
  return params.intent.kind !== "generic_unmatched";
}

export function createHetangMessageEntryService(params: {
  config: HetangOpsConfig;
  runtime: HetangCommandRuntime;
  logger: HetangLogger;
  now?: () => Date;
  commandRunner?: typeof runHetangCommand;
  queryRunner?: typeof runHetangTypedQuery;
  deliverNotificationMessage?: DeferredNotificationSender;
  inboundHandlerFactory?: (capture: CapturedInboundPass) => HetangInboundHandler;
  conversationSemanticStateService?: Pick<
    HetangConversationSemanticStateService,
    "resolveTurnState" | "recordTurnResult"
  >;
  semanticQualityService?: Pick<HetangSemanticQualityService, "recordSemanticExecutionAudit">;
  xiaohongshuLinkService?: XiaohongshuLinkServiceLike;
}) {
  const buildInboundHandler =
    params.inboundHandlerFactory ??
    ((capture: CapturedInboundPass) =>
      createHetangInboundClaimHandler({
        config: params.config,
        runtime: params.runtime,
        logger: params.logger,
        observeRoute: (route) => {
          capture.route = route;
        },
        observeMetaQueryProbeOutcome: (outcome) => {
          capture.metaQueryProbeOutcome = outcome;
        },
        now: params.now,
        sendReply: (async (reply) => {
          capture.current = reply;
        }) satisfies HetangInboundReplySender,
      }));
  const commandRunner = params.commandRunner ?? runHetangCommand;
  const queryRunner = params.queryRunner ?? runHetangTypedQuery;
  const correctionInterrupt = createCorrectionInterruptService({
    ttlMs: params.config.conversationQuality.correctionInterrupt.recentTurnTtlMs,
    now: () => (params.now?.() ?? new Date()).getTime(),
  });
  let routingModeCache:
    | {
        value: {
          baseRoutingMode: RoutingMode;
          semanticCanarySenderIds: string[];
        };
        expiresAtMs: number;
      }
    | null = null;

  const resolveRoutingControls = async (): Promise<{
    baseRoutingMode: RoutingMode;
    semanticCanarySenderIds: string[];
  }> => {
    const nowMs = (params.now?.() ?? new Date()).getTime();
    if (routingModeCache && routingModeCache.expiresAtMs > nowMs) {
      return routingModeCache.value;
    }
    if (typeof params.runtime.resolveControlTowerSettings !== "function") {
      return {
        baseRoutingMode: "legacy",
        semanticCanarySenderIds: [],
      };
    }
    try {
      const settings = await params.runtime.resolveControlTowerSettings({});
      const mode = settings["routing.mode"];
      const baseRoutingMode: RoutingMode =
        mode === "shadow" || mode === "semantic" ? mode : "legacy";
      routingModeCache = {
        value: {
          baseRoutingMode,
          semanticCanarySenderIds: parseControlTowerSenderAllowlist(
            settings["routing.semanticCanarySenderIds"],
          ),
        },
        expiresAtMs: nowMs + ROUTING_MODE_CACHE_TTL_MS,
      };
      return routingModeCache.value;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      params.logger.warn(`hetang-ops: routing mode lookup failed: ${message}`);
      return {
        baseRoutingMode: "legacy",
        semanticCanarySenderIds: [],
      };
    }
  };

  const resolveInboundFrontDoorState = async (input: {
    request: HetangBridgeInboundRequest;
    effectiveContent: string;
    semanticState?: ConversationSemanticTurnState["snapshot"];
  }) => {
    const routingControls = await resolveRoutingControls();
    const semanticCanaryApplied =
      routingControls.baseRoutingMode !== "semantic" &&
      input.request.sender_id !== undefined &&
      routingControls.semanticCanarySenderIds.includes(input.request.sender_id);
    const effectiveRoutingMode: RoutingMode = semanticCanaryApplied
      ? "semantic"
      : routingControls.baseRoutingMode;
    const binding =
      effectiveRoutingMode === "legacy"
        ? null
        : await resolveInboundEmployeeBinding({
            config: params.config,
            runtime: params.runtime as never,
            logger: params.logger,
            event: {
              channel: input.request.channel,
              senderId: input.request.sender_id,
              senderName: input.request.sender_name,
            },
          });
    const semanticIntent =
      effectiveRoutingMode === "legacy"
        ? null
        : resolveSemanticIntent({
            config: params.config,
            text: input.effectiveContent,
            now: params.now?.() ?? new Date(),
            binding,
            defaultOrgId: resolveDefaultNaturalLanguageOrgId(binding),
            semanticState: input.semanticState,
          });
    const compareOnlyLegacyRoute =
      effectiveRoutingMode === "legacy"
        ? null
        : resolveLegacyInboundRouteSnapshot({
            config: params.config,
            text: input.effectiveContent,
            now: params.now?.() ?? new Date(),
            binding,
            defaultOrgId: resolveDefaultNaturalLanguageOrgId(binding),
          });

    const frontDoorPrechecks: FrontDoorPrechecks = {
      groupNoop: false,
      routingControlsResolved: true,
      bindingLookupCompleted: effectiveRoutingMode !== "legacy",
      bindingPresent: binding !== null,
      semanticIntentResolved: semanticIntent !== null,
      legacyCompareRouteResolved: compareOnlyLegacyRoute !== null,
      effectiveRoutingMode,
    };

    return {
      routingControls,
      semanticCanaryApplied,
      effectiveRoutingMode,
      binding,
      semanticIntent,
      compareOnlyLegacyRoute,
      frontDoorPrechecks,
    };
  };

  return {
    describeCapabilities(): HetangBridgeCapabilities {
      const graphSnapshot = buildCapabilityGraphSnapshot();
      const toolDescriptors = listHetangToolDescriptors();
      return {
        version: "v1",
        entries: ["command", "inbound"],
        audit_surfaces: [
          {
            entry: "command",
            sink: "command_audit_logs",
            persistence: "required",
          },
          {
            entry: "inbound",
            sink: "inbound_message_audit_logs",
            persistence: "best_effort",
          },
        ],
        observability_streams: [
          "route_compare_log",
          "command_audit_log",
          "inbound_audit_log",
        ],
        control_plane_contract_version: CONTROL_PLANE_CONTRACT_VERSION,
        tool_contract_version: HETANG_TOOLS_CONTRACT_VERSION,
        query_graph_version: graphSnapshot.version,
        tool_count: toolDescriptors.length,
        serving_capability_count: graphSnapshot.serving_node_count,
        runtime_render_capability_count: graphSnapshot.runtime_render_node_count,
        async_analysis_capability_count: graphSnapshot.async_analysis_node_count,
        capability_node_count: graphSnapshot.node_count,
      };
    },

    async handleCommandMessage(request: HetangBridgeCommandRequest): Promise<HetangBridgeResponse> {
      const args = resolveCommandArgs(request);
      const text = await commandRunner({
        runtime: params.runtime,
        config: params.config,
        args,
        channel: request.channel,
        senderId: request.sender_id,
        commandBody: request.content,
        accountId: request.account_id,
        messageThreadId: request.thread_id,
        replyTarget: request.reply_target ?? request.conversation_id ?? request.sender_id,
        now: params.now?.(),
      });

      return buildImmediateResponse({
        handled: true,
        entry: "command",
        text,
      });
    },

    async handleInboundMessage(request: HetangBridgeInboundRequest): Promise<HetangBridgeResponse> {
      const inboundAcceptedText =
        params.xiaohongshuLinkService?.canHandleText(request.content) === true
          ? params.config.inboundLinkReaders.xiaohongshu.acceptText
          : DEFAULT_INBOUND_ACCEPT_TEXT;
      const processInboundMessage = async (): Promise<HetangBridgeResponse> => {
        const startedAtMs = Date.now();
        const turnNow = params.now?.() ?? new Date();
        const correctionKey = buildCorrectionInterruptKey({
          channel: request.channel,
          accountId: request.account_id,
          conversationId: request.conversation_id,
          senderId: request.sender_id,
          threadId: request.thread_id,
        });
        const correctionDecision = params.config.conversationQuality.correctionInterrupt.enabled
          ? correctionInterrupt.resolveCorrection({
              key: correctionKey,
              text: request.content,
            })
          : { action: "continue" as const };
        const correctedContent =
          correctionDecision.action === "repair"
            ? correctionDecision.previousUserText
            : request.content;
        if (request.is_group && request.was_mentioned === false) {
          return buildInboundNoopResponse(false);
        }
        let semanticTurnState: ConversationSemanticTurnState | null = null;
        if (params.conversationSemanticStateService) {
          try {
            semanticTurnState = await params.conversationSemanticStateService.resolveTurnState({
              config: params.config,
              channel: request.channel,
              senderId: request.sender_id,
              conversationId: request.conversation_id,
              text: correctedContent,
              now: turnNow,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            params.logger.warn(`hetang-ops: semantic state resolve failed: ${message}`);
          }
        }
        const effectiveContent = semanticTurnState?.effectiveText ?? correctedContent;
        const inboundAuditRecord: HetangInboundMessageAuditRecord = {
          requestId: request.request_id,
          channel: request.channel,
          accountId: request.account_id,
          senderId: request.sender_id,
          senderName: request.sender_name,
          conversationId: request.conversation_id,
          threadId: request.thread_id,
          isGroup: request.is_group,
          wasMentioned: request.was_mentioned,
          platformMessageId: request.platform_message_id,
          content: request.content,
          effectiveContent,
          receivedAt: request.received_at,
        };
        try {
          const auditWrite = params.runtime.recordInboundMessageAudit(inboundAuditRecord);
          void Promise.resolve(auditWrite).catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            params.logger.warn(`hetang-ops: inbound audit persistence failed: ${message}`);
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          params.logger.warn(`hetang-ops: inbound audit persistence failed: ${message}`);
        }
        if (params.xiaohongshuLinkService?.canHandleText(effectiveContent)) {
          const xiaohongshuReply = await params.xiaohongshuLinkService.buildReplyForText({
            requestId: request.request_id,
            text: effectiveContent,
          });
          if (xiaohongshuReply) {
            return buildImmediateResponse({
              handled: true,
              entry: "inbound",
              text: xiaohongshuReply,
            });
          }
        }
        const {
          routingControls,
          semanticCanaryApplied,
          effectiveRoutingMode,
          binding,
          semanticIntent,
          compareOnlyLegacyRoute,
          frontDoorPrechecks,
        } = await resolveInboundFrontDoorState({
          request,
          effectiveContent,
          semanticState: semanticTurnState?.snapshot,
        });

        const runInboundPass = async (content: string) => {
          const capture: CapturedInboundPass = {
            current: null as CapturedReply | null,
            route: null as HetangRouteSnapshot | null,
            metaQueryProbeOutcome: null,
          };
          const handler = buildInboundHandler(capture);
          const result = await handler(
            {
              channel: request.channel,
              accountId: request.account_id,
              conversationId: request.conversation_id,
              senderId: request.sender_id,
              senderName: request.sender_name,
              threadId: request.thread_id,
              content,
              isGroup: request.is_group,
              wasMentioned: request.was_mentioned,
            },
            {
              channelId: request.channel,
              accountId: request.account_id,
              conversationId: request.conversation_id,
            },
          );
          return { capture, result };
        };

        let pass:
          | {
              capture: CapturedInboundPass;
              result: { handled: true } | void;
            }
          | null = null;
        let frontDoorDecision: FrontDoorDecision = "legacy_pass";
        let semanticMetaQueryProbeOutcome: HetangSemanticMetaQueryProbeOutcome | null = null;
        const semanticFrontDoorAction =
          effectiveRoutingMode === "semantic"
            ? await executeSemanticFrontDoorAction({
                config: params.config,
                runtime: params.runtime,
                logger: params.logger,
                text: effectiveContent,
                intent: semanticIntent!,
                binding,
                channel: request.channel,
                senderId: request.sender_id,
                notification: {
                  channel: request.channel,
                  target: request.conversation_id ?? request.sender_id ?? "",
                  accountId: request.account_id,
                  threadId: request.thread_id == null ? undefined : String(request.thread_id),
                },
                now: params.now?.() ?? new Date(),
                queryRunner,
              })
            : {
                decision: "continue" as const,
                text: undefined,
                probeOutcome: null,
              };
        semanticMetaQueryProbeOutcome = semanticFrontDoorAction.probeOutcome;
        let text: string | undefined =
          semanticFrontDoorAction.decision === "continue" ? undefined : semanticFrontDoorAction.text;
        if (semanticFrontDoorAction.decision !== "continue") {
          frontDoorDecision = semanticFrontDoorAction.decision;
        }
        if (text === undefined) {
          pass = await runInboundPass(effectiveContent);
          frontDoorDecision = pass.result ? "legacy_pass" : "legacy_noop";
        }
        let replyGuardIntervened = false;

        const emitRouteTelemetry = (legacyRoute: HetangRouteSnapshot | null) => {
          if (effectiveRoutingMode === "legacy" || !semanticIntent) {
            return;
          }
          const driftTags = resolveRouteDriftTags({
            legacyRoute,
            semanticIntent,
          });
          const routeComparePayload = {
            routingMode: effectiveRoutingMode,
            baseRoutingMode: routingControls.baseRoutingMode,
            effectiveRoutingMode,
            semanticCanaryApplied,
            frontDoorDecision,
            rawText: request.content,
            effectiveText: effectiveContent,
            legacyRoute: formatHetangRouteSnapshot(legacyRoute),
            semanticRoute: formatHetangRouteSnapshot(semanticIntent),
            selectedLane: semanticIntent.lane,
            legacyCapabilityId: legacyRoute?.capabilityId ?? null,
            selectedCapabilityId: semanticIntent.capabilityId ?? null,
            legacyMetaQueryProbeOutcome: pass?.capture.metaQueryProbeOutcome ?? null,
            semanticMetaQueryProbeOutcome,
            clarificationNeeded: semanticIntent.clarificationNeeded,
            replyGuardIntervened,
            driftTags,
            frontDoorPrechecks,
            latencyMs: Date.now() - startedAtMs,
          };
          params.logger.info(`hetang-ops: route-compare ${JSON.stringify(routeComparePayload)}`);
          if (driftTags.length > 0) {
            params.logger.warn(`hetang-ops: route-drift ${JSON.stringify(routeComparePayload)}`);
          }
        };

        const resolvedLegacyRoute = mergeRouteSnapshot(
          pass?.capture.route ?? null,
          compareOnlyLegacyRoute,
        );

        if (pass && !pass.result) {
          emitRouteTelemetry(resolvedLegacyRoute);
          return buildInboundNoopResponse(false);
        }

        text ??= pass?.capture.current?.message;
        if (
          text &&
          params.config.conversationQuality.replyGuard.enabled &&
          shouldRunReplyGuard({ text: effectiveContent })
        ) {
          let guardDecision = resolveReplyGuardDecision({
            config: params.config,
            userText: effectiveContent,
            replyText: text,
          });
          if (guardDecision.action !== "send") {
            replyGuardIntervened = true;
          }
          if (
            guardDecision.action === "repair" &&
            params.config.conversationQuality.replyGuard.allowOneRepairAttempt
          ) {
            pass = await runInboundPass(effectiveContent);
            frontDoorDecision = pass.result ? "legacy_pass" : "legacy_noop";
            text = pass.capture.current?.message;
            guardDecision =
              text === undefined
                ? { action: "send" }
                : resolveReplyGuardDecision({
                    config: params.config,
                    userText: effectiveContent,
                    replyText: text,
                  });
            if (guardDecision.action !== "send") {
              replyGuardIntervened = true;
            }
          }
          if (guardDecision.action === "clarify") {
            text = guardDecision.text;
          }
        }

        if (text && correctionDecision.action === "repair") {
          text = `${correctionDecision.prefixText}\n${text}`;
        }
        if (text && params.config.conversationQuality.correctionInterrupt.enabled) {
          correctionInterrupt.rememberTurn({
            key: correctionKey,
            userText: effectiveContent,
            assistantText: text,
          });
        }

        emitRouteTelemetry(resolvedLegacyRoute);

        if (params.conversationSemanticStateService && semanticIntent) {
          try {
            await params.conversationSemanticStateService.recordTurnResult({
              sessionId:
                semanticTurnState?.sessionId ??
                `${request.channel}:${request.conversation_id ?? request.sender_id ?? "anonymous"}`,
              channel: request.channel,
              senderId: request.sender_id,
              conversationId: request.conversation_id,
              rawText: request.content,
              effectiveText: effectiveContent,
              semanticIntent,
              now: turnNow,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            params.logger.warn(`hetang-ops: semantic state persistence failed: ${message}`);
          }
        }
        if (params.semanticQualityService && semanticIntent) {
          try {
            const semanticAuditVersion = await resolveSemanticAuditVersionContext(params.runtime);
            await params.semanticQualityService.recordSemanticExecutionAudit({
              requestId: request.request_id,
              entry: "inbound",
              channel: request.channel,
              senderId: request.sender_id,
              conversationId: request.conversation_id,
              rawText: request.content,
              effectiveText: effectiveContent,
              semanticLane: semanticIntent.lane,
              intentKind: semanticIntent.kind,
              capabilityId: semanticIntent.capabilityId,
              ...semanticAuditVersion,
              stateCarriedForward: semanticTurnState?.stateCarriedForward === true,
              topicSwitchDetected: semanticTurnState?.topicSwitchDetected === true,
              clarificationNeeded: semanticIntent.clarificationNeeded,
              clarificationReason: resolveSemanticClarificationReason(semanticIntent),
              success: resolveSemanticEntrySuccess({
                intent: semanticIntent,
                text,
              }),
              durationMs: Date.now() - startedAtMs,
              occurredAt: turnNow.toISOString(),
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            params.logger.warn(`hetang-ops: semantic quality persistence failed: ${message}`);
          }
        }

        return buildImmediateResponse({
          handled: true,
          entry: "inbound",
          text,
        });
      };

      const notification =
        params.deliverNotificationMessage === undefined
          ? null
          : resolveDeferredInboundNotification(request);
      if (!params.deliverNotificationMessage || !notification) {
        return await processInboundMessage();
      }

      let acceptedTimer: ReturnType<typeof setTimeout> | null = null;
      const responsePromise = processInboundMessage();
      try {
        const raced = await Promise.race([
          responsePromise.then((response) => ({ kind: "response" as const, response })),
          new Promise<{ kind: "accepted" }>((resolve) => {
            acceptedTimer = setTimeout(() => resolve({ kind: "accepted" }), DEFAULT_INBOUND_ACCEPT_AFTER_MS);
          }),
        ]);
        if (acceptedTimer) {
          clearTimeout(acceptedTimer);
          acceptedTimer = null;
        }
        if (raced.kind === "response") {
          return raced.response;
        }
      } catch (error) {
        if (acceptedTimer) {
          clearTimeout(acceptedTimer);
        }
        throw error;
      }

      params.logger.info(
        `hetang-ops: inbound accepted request_id=${request.request_id} conversation=${notification.target}`,
      );
      void responsePromise
        .then(async (response) => {
          const finalText = resolveDeferredInboundFinalText(response);
          if (!finalText) {
            params.logger.info(
              `hetang-ops: deferred inbound completed without final reply for ${request.request_id} target=${notification.target}`,
            );
            return;
          }
          const deliverySummary = summarizeDeferredInboundText(finalText);
          params.logger.info(
            `hetang-ops: deferred inbound delivery attempt for ${request.request_id} target=${notification.target} chars=${deliverySummary.length} excerpt=${JSON.stringify(deliverySummary.excerpt)}`,
          );
          try {
            await params.deliverNotificationMessage?.({
              notification,
              message: finalText,
            });
            params.logger.info(
              `hetang-ops: deferred inbound delivery succeeded for ${request.request_id} target=${notification.target} chars=${deliverySummary.length}`,
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            params.logger.warn(
              `hetang-ops: deferred inbound delivery failed for ${request.request_id}: ${message}`,
            );
          }
        })
        .catch(async (error) => {
          const message = error instanceof Error ? error.message : String(error);
          params.logger.warn(
            `hetang-ops: deferred inbound processing failed for ${request.request_id}: ${message}`,
          );
          try {
            await params.deliverNotificationMessage?.({
              notification,
              message: DEFAULT_DEFERRED_INBOUND_FAILURE_TEXT,
            });
          } catch (deliveryError) {
            const deliveryMessage =
              deliveryError instanceof Error ? deliveryError.message : String(deliveryError);
            params.logger.warn(
              `hetang-ops: deferred inbound failure delivery failed for ${request.request_id}: ${deliveryMessage}`,
            );
          }
        });

      return buildAcceptedResponse({
        handled: true,
        entry: "inbound",
        text: inboundAcceptedText,
      });
    },
  };
}
