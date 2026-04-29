import type {
  HetangSemanticAnalysisFrameworkCount,
  HetangConversationReviewFinding,
  HetangConversationClarificationReason,
  HetangSemanticExecutionAuditInput,
  HetangSemanticExecutionAuditRecord,
  HetangSemanticExecutionFailureClass,
  HetangSemanticFailureClassCount,
  HetangSemanticOptimizationBacklogItem,
  HetangSemanticOptimizationBacklogPriority,
  HetangSemanticQualitySummary,
  HetangSemanticRouteUpgradeCount,
  HetangSemanticSampleCandidate,
} from "../types.js";
import { resolveSemanticOptimizationPlaybookEntry } from "../semantic-optimization-playbook.js";

type SemanticExecutionAuditStore = {
  insertSemanticExecutionAudit: (record: HetangSemanticExecutionAuditRecord) => Promise<void>;
  getSemanticQualitySummary: (params: {
    windowHours: number;
    now: Date;
    limit: number;
    occurredAfter?: string;
    deployMarker?: string;
  }) => Promise<HetangSemanticQualitySummary>;
  getSemanticFailureTopCounts: (params: {
    windowHours: number;
    now: Date;
    limit: number;
  }) => Promise<Array<{ failureClass: string; count: number }>>;
};

const DEFAULT_TOP_FAILURE_LIMIT = 5;

type ReviewOptimizationMapping = {
  ownerModule: string;
  recommendedAction: string;
  priority: HetangSemanticOptimizationBacklogPriority;
  sampleTag: string;
};

type SemanticOptimizationPlaybookEntry = {
  ownerModule: string;
  recommendedAction: string;
  priority: HetangSemanticOptimizationBacklogPriority;
  samples: Array<{
    sampleTag: string;
    prompt: string;
  }>;
};

function resolveConversationReviewSignalType(
  finding: Pick<HetangConversationReviewFinding, "evidenceJson">,
): string | undefined {
  try {
    const parsed = JSON.parse(finding.evidenceJson) as { signalType?: unknown };
    return typeof parsed.signalType === "string" ? parsed.signalType : undefined;
  } catch {
    return undefined;
  }
}

function resolveConversationReviewOptimizationMapping(
  findingType: HetangConversationReviewFinding["findingType"],
  finding?: Pick<HetangConversationReviewFinding, "evidenceJson">,
): ReviewOptimizationMapping {
  switch (findingType) {
    case "scope_gap":
      return {
        ownerModule: "src/query-intent.ts",
        recommendedAction: "把“这几天/近几天”这类口语时间窗补进默认窗口规则和 clarify carry 样本。",
        priority: "high",
        sampleTag: "review_scope_gap",
      };
    case "analysis_gap":
      return {
        ownerModule: "src/app/analysis-bounded-synthesis.ts",
        recommendedAction: "补 analysis fallback 样本并收紧 bounded synthesis / diagnostics 降级链路。",
        priority: "high",
        sampleTag: "review_analysis_gap",
      };
    case "reply_quality_issue":
      return {
        ownerModule: "src/query-engine-renderer.ts",
        recommendedAction: "补高频回复质量失败样本，收紧输出模板和 reply guard。",
        priority: "high",
        sampleTag: "review_reply_quality",
      };
    case "memory_candidate":
      return {
        ownerModule: "src/app/conversation-semantic-state-service.ts",
        recommendedAction: "评估是否将用户给出的稳定口径升级为受控默认规则或状态锚点。",
        priority: "medium",
        sampleTag: "review_memory_candidate",
      };
    case "capability_gap": {
      const signalType = finding ? resolveConversationReviewSignalType(finding) : undefined;
      if (signalType === "stale_profile" || signalType === "missing_observation") {
        return {
          ownerModule: "src/world-model/customer-profile-evidence.ts",
          recommendedAction: "补顾客经营画像 evidence 装配和夜间巡检规则，显式标出缺 observation / 画像过期。",
          priority: "high",
          sampleTag: "review_customer_profile_gap",
        };
      }
      return {
        ownerModule: "src/semantic-intent.ts",
        recommendedAction: "补 capability gap 对应的 owner path，并避免把问题继续留在语义主链兜底。",
        priority: "medium",
        sampleTag: "review_capability_gap",
      };
    }
    default:
      return {
        ownerModule: "src/semantic-intent.ts",
        recommendedAction: "补 conversation review 暴露的失败样本，并收敛到 semantic intent / capability graph 主链。",
        priority: "medium",
        sampleTag: `review_${findingType}`,
      };
  }
}

function hasReviewFollowupTarget(
  finding: HetangConversationReviewFinding,
  target: "sample_candidate" | "backlog_candidate" | "deploy_followup_candidate",
): boolean {
  return (finding.followupTargets ?? []).includes(target);
}

function tryResolveReviewPrompt(finding: HetangConversationReviewFinding): string | null {
  try {
    const parsed = JSON.parse(finding.evidenceJson) as { rawText?: unknown };
    if (typeof parsed.rawText === "string" && parsed.rawText.trim().length > 0) {
      return parsed.rawText.trim();
    }
  } catch {
    return null;
  }
  return null;
}

function buildReviewBacklog(
  findings: HetangConversationReviewFinding[],
): HetangSemanticOptimizationBacklogItem[] {
  const counts = new Map<
    string,
    { count: number; exemplar: HetangConversationReviewFinding }
  >();
  for (const finding of findings) {
    if (!hasReviewFollowupTarget(finding, "backlog_candidate")) {
      continue;
    }
    const current = counts.get(finding.findingType);
    if (current) {
      current.count += 1;
      continue;
    }
    counts.set(finding.findingType, {
      count: 1,
      exemplar: finding,
    });
  }
  return Array.from(counts.entries())
    .map(([findingType, bucket]) => {
      const mapping = resolveConversationReviewOptimizationMapping(
        findingType as HetangConversationReviewFinding["findingType"],
        bucket.exemplar,
      );
      return {
        source: "conversation_review" as const,
        failureClass: `review:${findingType}`,
        count: bucket.count,
        ownerModule: mapping.ownerModule,
        recommendedAction: mapping.recommendedAction,
        priority: mapping.priority,
      };
    })
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return left.failureClass.localeCompare(right.failureClass);
    });
}

function buildReviewSampleCandidates(
  findings: HetangConversationReviewFinding[],
): HetangSemanticSampleCandidate[] {
  const backlogCounts = new Map<string, number>();
  for (const finding of findings) {
    backlogCounts.set(finding.findingType, (backlogCounts.get(finding.findingType) ?? 0) + 1);
  }
  const seen = new Set<string>();
  const candidates: HetangSemanticSampleCandidate[] = [];
  for (const finding of findings) {
    if (!hasReviewFollowupTarget(finding, "sample_candidate")) {
      continue;
    }
    const prompt = tryResolveReviewPrompt(finding);
    if (!prompt) {
      continue;
    }
    const dedupeKey = `${finding.findingType}|${prompt}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    const mapping = resolveConversationReviewOptimizationMapping(finding.findingType, finding);
    candidates.push({
      source: "conversation_review",
      failureClass: `review:${finding.findingType}`,
      count: backlogCounts.get(finding.findingType) ?? 1,
      ownerModule: mapping.ownerModule,
      sampleTag: mapping.sampleTag,
      prompt,
    });
  }
  return candidates;
}

function countReviewDeployFollowups(findings: HetangConversationReviewFinding[]): number {
  return findings.filter((finding) =>
    hasReviewFollowupTarget(finding, "deploy_followup_candidate"),
  ).length;
}

function normalizeFailureClassToken(value: string): string {
  return value.replace(/-/gu, "_");
}

const COLLOQUIAL_LANE_MISS_RE =
  /(盘子怎么样|盘子如何|生意好不好|生意行不行|生意还行吗|客人跟得怎么样|客户跟得怎么样|技师状态怎么样|帮我看看)/u;
const OBJECT_SWITCH_CONTINUATION_RE =
  /^(那|那么)?(顾客|客人|客户|会员|技师|老师|风险|建议|排行|排名|复盘)(呢|怎么样|情况|状态|如何)?$/u;

function resolveClarifyFailureClass(
  reason?: HetangConversationClarificationReason | string,
  intentKind?: string,
): HetangSemanticExecutionFailureClass | string {
  if (reason) {
    return `clarify_${normalizeFailureClassToken(reason)}`;
  }
  if (intentKind?.startsWith("clarify_")) {
    return intentKind;
  }
  return "semantic_failure";
}

function resolveFailureClass(
  input: HetangSemanticExecutionAuditInput,
): HetangSemanticExecutionFailureClass | string | undefined {
  if (input.failureClass) {
    return input.failureClass;
  }
  if (input.clarificationNeeded) {
    return resolveClarifyFailureClass(input.clarificationReason, input.intentKind);
  }
  if (input.success === true) {
    return undefined;
  }
  if (input.intentKind === "generic_unmatched") {
    if (
      input.topicSwitchDetected === true &&
      (OBJECT_SWITCH_CONTINUATION_RE.test(input.rawText) ||
        OBJECT_SWITCH_CONTINUATION_RE.test(input.effectiveText ?? ""))
    ) {
      return "topic_switch_false_positive";
    }
    if (
      OBJECT_SWITCH_CONTINUATION_RE.test(input.rawText) ||
      OBJECT_SWITCH_CONTINUATION_RE.test(input.effectiveText ?? "")
    ) {
      return "scope_inheritance_miss";
    }
    if (COLLOQUIAL_LANE_MISS_RE.test(input.rawText) || COLLOQUIAL_LANE_MISS_RE.test(input.effectiveText ?? "")) {
      return "colloquial_lane_miss";
    }
    return "generic_unmatched";
  }
  if (input.intentKind?.startsWith("unsupported_")) {
    return input.intentKind;
  }
  if (input.entrySource === "none") {
    return "entry_unresolved";
  }
  return input.success === false ? "semantic_failure" : undefined;
}

function resolveDeployMarker(input: HetangSemanticExecutionAuditInput): string | undefined {
  if (typeof input.deployMarker === "string" && input.deployMarker.trim().length > 0) {
    return input.deployMarker.trim();
  }
  if (typeof input.servingVersion === "string" && input.servingVersion.trim().length > 0) {
    return `serving:${input.servingVersion.trim()}`;
  }
  return undefined;
}

function resolveOptimizationPlaybookEntry(
  failureClass: string,
): SemanticOptimizationPlaybookEntry {
  return resolveSemanticOptimizationPlaybookEntry(failureClass);
}

function buildOptimizationBacklog(
  topFailureClasses: HetangSemanticFailureClassCount[],
): HetangSemanticOptimizationBacklogItem[] {
  return topFailureClasses.map((entry) => {
    const playbook = resolveOptimizationPlaybookEntry(entry.failureClass);
    return {
      failureClass: entry.failureClass,
      count: entry.count,
      ownerModule: playbook.ownerModule,
      recommendedAction: playbook.recommendedAction,
      priority: playbook.priority,
    };
  });
}

function buildSampleCandidates(
  topFailureClasses: HetangSemanticFailureClassCount[],
): HetangSemanticSampleCandidate[] {
  return topFailureClasses.flatMap((entry) => {
    const playbook = resolveOptimizationPlaybookEntry(entry.failureClass);
    return playbook.samples.map((sample) => ({
      failureClass: entry.failureClass,
      count: entry.count,
      ownerModule: playbook.ownerModule,
      sampleTag: sample.sampleTag,
      prompt: sample.prompt,
    }));
  });
}

export class HetangSemanticQualityService {
  constructor(
    private readonly deps: {
      store: SemanticExecutionAuditStore;
      listLatestConversationReviewFindings?: () => Promise<HetangConversationReviewFinding[]>;
    },
  ) {}

  async recordSemanticExecutionAudit(
    input: HetangSemanticExecutionAuditInput,
  ): Promise<void> {
    const failureClass = resolveFailureClass(input);
    const clarificationNeeded =
      input.clarificationNeeded === true || failureClass?.startsWith("clarify_") === true;
    const record: HetangSemanticExecutionAuditRecord = {
      requestId: input.requestId,
      entry: input.entry,
      entrySource: input.entrySource,
      channel: input.channel,
      senderId: input.senderId,
      conversationId: input.conversationId,
      rawText: input.rawText,
      effectiveText: input.effectiveText,
      semanticLane: input.semanticLane,
      intentKind: input.intentKind,
      capabilityId: input.capabilityId,
      analysisFrameworkId: input.analysisFrameworkId,
      analysisPersonaId: input.analysisPersonaId,
      routeUpgradeKind: input.routeUpgradeKind,
      stateCarriedForward: input.stateCarriedForward === true,
      topicSwitchDetected: input.topicSwitchDetected === true,
      deployMarker: resolveDeployMarker(input),
      servingVersion: input.servingVersion,
      clarificationNeeded,
      clarificationReason: input.clarificationReason,
      fallbackUsed: input.fallbackUsed === true || input.entrySource === "ai_fallback",
      executed:
        input.executed ??
        (input.semanticLane === "query" || input.semanticLane === "analysis"),
      success: input.success ?? failureClass === undefined,
      failureClass,
      durationMs: input.durationMs,
      occurredAt: input.occurredAt ?? new Date().toISOString(),
    };
    await this.deps.store.insertSemanticExecutionAudit(record);
  }

  async getSemanticQualitySummary(params: {
    windowHours?: number;
    now?: Date;
    limit?: number;
    occurredAfter?: string;
    deployMarker?: string;
  } = {}): Promise<HetangSemanticQualitySummary> {
    const summary = await this.deps.store.getSemanticQualitySummary({
      windowHours: params.windowHours ?? 24,
      now: params.now ?? new Date(),
      limit: params.limit ?? DEFAULT_TOP_FAILURE_LIMIT,
      occurredAfter: params.occurredAfter,
      deployMarker: params.deployMarker,
    });
    return {
      ...summary,
      topAnalysisFrameworks:
        (summary.topAnalysisFrameworks as HetangSemanticAnalysisFrameworkCount[] | undefined) ?? [],
      topRouteUpgrades:
        (summary.topRouteUpgrades as HetangSemanticRouteUpgradeCount[] | undefined) ?? [],
      optimizationBacklog: buildOptimizationBacklog(summary.topFailureClasses),
      sampleCandidates: buildSampleCandidates(summary.topFailureClasses),
      reviewBacklog: this.deps.listLatestConversationReviewFindings
        ? buildReviewBacklog(await this.deps.listLatestConversationReviewFindings())
        : [],
      reviewSampleCandidates: this.deps.listLatestConversationReviewFindings
        ? buildReviewSampleCandidates(await this.deps.listLatestConversationReviewFindings())
        : [],
      reviewDeployFollowupCount: this.deps.listLatestConversationReviewFindings
        ? countReviewDeployFollowups(await this.deps.listLatestConversationReviewFindings())
        : 0,
    };
  }
}
