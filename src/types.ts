export type HetangNotificationTarget = {
  channel: string;
  target: string;
  accountId?: string;
  threadId?: string;
  enabled: boolean;
};

export type HetangCustomerGrowthPrimarySegmentThresholds = {
  highValueMemberVisitCount90d?: number;
  highValueMemberPayAmount90d?: number;
  highValueMemberActiveMaxSilentDays?: number;
  potentialGrowthPayAmount90d?: number;
  potentialGrowthMaxVisitCount90d?: number;
};

export type HetangStoreReactivationCapacityConfig = {
  dailyTouchCapacity?: number;
};

export type HetangStoreCustomerGrowthConfig = {
  primarySegmentThresholds?: HetangCustomerGrowthPrimarySegmentThresholds;
  reactivationCapacity?: HetangStoreReactivationCapacityConfig;
};

export type HetangStoreConfig = {
  orgId: string;
  storeName: string;
  rawAliases: string[];
  isActive: boolean;
  notification?: HetangNotificationTarget;
  customerGrowth?: HetangStoreCustomerGrowthConfig;
  roomCount?: number;
  operatingHoursPerDay?: number;
  fixedMonthlyCost?: number;
  variableCostRate?: number;
  materialCostRate?: number;
};

export type HetangApiConfig = {
  appKey?: string;
  appSecret?: string;
  baseUrl: string;
  pageSize: number;
  timeoutMs: number;
  maxRetries: number;
};

export type HetangSyncConfig = {
  enabled: boolean;
  initialBackfillDays: number;
  overlapDays: number;
  runAtLocalTime: string;
  accessWindowStartLocalTime: string;
  accessWindowEndLocalTime: string;
  businessDayCutoffLocalTime: string;
  historyCatchupAtLocalTime: string;
  historyBackfillEnabled: boolean;
  historyBackfillDays: number;
  historyBackfillSliceDays: number;
};

export type HetangHistoricalCoverageSpan = {
  rowCount: number;
  dayCount: number;
  minBizDate?: string;
  maxBizDate?: string;
  firstMissingBizDate?: string;
};

export type HetangHistoricalCoverageSnapshot = {
  orgId: string;
  startBizDate: string;
  endBizDate: string;
  rawFacts: Partial<Record<EndpointCode, HetangHistoricalCoverageSpan>>;
  derivedLayers: {
    factMemberDailySnapshot?: HetangHistoricalCoverageSpan;
    martCustomerSegments?: HetangHistoricalCoverageSpan;
    martCustomerConversionCohorts?: HetangHistoricalCoverageSpan;
    mvCustomerProfile90d?: HetangHistoricalCoverageSpan;
  };
};

export type HetangReportingConfig = {
  enabled: boolean;
  buildAtLocalTime: string;
  sendAtLocalTime: string;
  fiveStoreDailyOverviewAtLocalTime: string;
  weeklyReportAtLocalTime: string;
  weeklyReportStartDate?: string;
  monthlyReportAtLocalTime: string;
  monthlyReportStartMonth?: string;
  weeklyChartAtLocalTime: string;
  weeklyChartStartDate?: string;
  middayBriefAtLocalTime: string;
  reactivationPushAtLocalTime: string;
  sharedDelivery?: HetangNotificationTarget;
  sendReportEnabled: boolean;
  sendFiveStoreDailyOverviewEnabled: boolean;
  sendWeeklyReportEnabled: boolean;
  sendMonthlyReportEnabled: boolean;
  sendWeeklyChartEnabled: boolean;
  sendMiddayBriefEnabled: boolean;
  sendReactivationPushEnabled: boolean;
};

export type HetangAnalysisConfig = {
  revenueDropAlertThreshold: number;
  clockDropAlertThreshold: number;
  antiRatioAlertThreshold: number;
  lowTechActiveCountThreshold: number;
  lowStoredConsumeRateThreshold: number;
  sleepingMemberRateAlertThreshold: number;
  highTechCommissionRateThreshold: number;
  defaultVariableCostRate?: number;
  defaultMaterialCostRate?: number;
  defaultFixedMonthlyCost?: number;
};

export type HetangSemanticFallbackConfig = {
  enabled: boolean;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  timeoutMs: number;
  autoAcceptConfidence: number;
  clarifyConfidence: number;
};

export type HetangCustomerGrowthAiModuleConfig = {
  enabled: boolean;
};

export type HetangCustomerGrowthAiConfig = {
  enabled: boolean;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  timeoutMs: number;
  profileInsight: HetangCustomerGrowthAiModuleConfig;
  tagAdvisor: HetangCustomerGrowthAiModuleConfig;
  strategyAdvisor: HetangCustomerGrowthAiModuleConfig;
  followupSummarizer: HetangCustomerGrowthAiModuleConfig;
};

export type HetangAiLaneId =
  | "general-lite"
  | "semantic-fallback"
  | "customer-growth-json"
  | "cheap-summary"
  | "analysis-premium"
  | "offline-review"
  | "hq-premium"
  | "world-model-explanation"
  | "doctor-review";

export type HetangAiLaneTaskClass =
  | "chat"
  | "json_extract"
  | "json_generate"
  | "summary"
  | "analysis"
  | "review";

export type HetangAiLaneExecutionMode = "sync" | "async" | "batch";

export type HetangAiLaneReasoningMode = "off" | "low" | "medium" | "high";

export type HetangAiLaneResponseMode = "text" | "json";

export type HetangAiLaneFallbackBehavior = "none" | "lane" | "deterministic" | "legacy";

export type HetangAiLaneConfig = {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  reasoningMode?: HetangAiLaneReasoningMode;
  timeoutMs?: number;
  responseMode?: HetangAiLaneResponseMode;
  fallbackBehavior?: HetangAiLaneFallbackBehavior;
  fallbackLaneId?: HetangAiLaneId;
};

export type HetangAiLaneRegistryConfig = Partial<Record<HetangAiLaneId, HetangAiLaneConfig>>;

export type HetangIntentClarifierConfig = {
  enabled: boolean;
  maxQuestionsPerTurn: number;
};

export type HetangReplyGuardConfig = {
  enabled: boolean;
  allowOneRepairAttempt: boolean;
};

export type HetangCorrectionInterruptConfig = {
  enabled: boolean;
  recentTurnTtlMs: number;
};

export type HetangConversationQualityConfig = {
  intentClarifier: HetangIntentClarifierConfig;
  replyGuard: HetangReplyGuardConfig;
  correctionInterrupt: HetangCorrectionInterruptConfig;
};

export type HetangXiaohongshuInboundLinkReaderConfig = {
  enabled: boolean;
  autocliBin?: string;
  timeoutMs: number;
  browserTimeoutMs: number;
  acceptText: string;
  maxContentChars: number;
};

export type HetangInboundLinkReadersConfig = {
  xiaohongshu: HetangXiaohongshuInboundLinkReaderConfig;
};

export type HetangDatabaseConfig = {
  url: string;
  queryUrl?: string;
  syncUrl?: string;
  analysisUrl?: string;
  queryPoolMax: number;
  syncPoolMax: number;
  analysisPoolMax: number;
};

export type HetangServiceWorkerMode = "all" | "scheduled" | "analysis";

export type HetangServiceConfig = {
  enableInGateway: boolean;
  scheduledPollIntervalMs: number;
  analysisPollIntervalMs: number;
};

export type HetangQueueConfig = {
  maxPendingAnalysisJobsPerOrg: number;
  deadLetterEnabled: boolean;
};

export type HetangAccessRole = "hq" | "manager" | "staff" | "disabled";

export type HetangEmployeeBinding = {
  channel: string;
  senderId: string;
  employeeName?: string;
  role: HetangAccessRole;
  orgId?: string;
  scopeOrgIds?: string[];
  isActive: boolean;
  hourlyQuota?: number;
  dailyQuota?: number;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type HetangCommandAuditDecision = "allowed" | "denied";

export type HetangCommandAuditRecord = {
  occurredAt: string;
  channel: string;
  senderId?: string;
  commandName: string;
  action: string;
  requestedOrgId?: string;
  effectiveOrgId?: string;
  decision: HetangCommandAuditDecision;
  consumeQuota?: boolean;
  reason: string;
  commandBody: string;
  responseExcerpt?: string;
  queryEntrySource?: string;
  queryEntryReason?: string;
};

export type HetangRecentCommandAuditSummary = {
  recentAllowedCount: number;
  windowHours: number;
  latestOccurredAt: string | null;
  latestCommandBody: string | null;
  latestAction: string | null;
  latestSenderId: string | null;
  recentQueryCount?: number;
  recentQueryRuleCount?: number;
  recentQueryClarifyCount?: number;
  recentQueryAiFallbackCount?: number;
  recentQueryUnresolvedCount?: number;
  latestQueryOccurredAt?: string | null;
  latestQueryEntrySource?: string | null;
  latestQueryEntryReason?: string | null;
};

export type HetangInboundMessageAuditRecord = {
  id?: number;
  requestId: string;
  channel: string;
  accountId?: string;
  senderId?: string;
  senderName?: string;
  conversationId?: string;
  threadId?: string;
  isGroup: boolean;
  wasMentioned?: boolean;
  platformMessageId?: string;
  content: string;
  effectiveContent?: string;
  receivedAt: string;
  recordedAt?: string;
};

export type HetangConversationClarificationReason =
  | "missing-store"
  | "missing-time"
  | "missing-metric"
  | "mixed-scope"
  | "missing-object-scope";

export type HetangConversationSemanticStateSnapshot = {
  sessionId: string;
  channel: string;
  senderId?: string;
  conversationId?: string;
  currentGoal?: string;
  currentLane?: "meta" | "query" | "analysis";
  lastIntentKind?: string;
  clarificationPending: boolean;
  clarificationReason?: HetangConversationClarificationReason;
  anchoredSlots: Record<string, unknown>;
  missingSlots: string[];
  beliefState: Record<string, unknown>;
  desireState: Record<string, unknown>;
  intentionState: Record<string, unknown>;
  lastRouteSnapshot?: Record<string, unknown>;
  confidence?: number;
  updatedAt: string;
  expiresAt?: string;
};

export type HetangConversationAnchorFactRecord = {
  sessionId: string;
  factType: string;
  factKey: string;
  factValue: Record<string, unknown>;
  sourceTurnId?: string;
  sourceKind: string;
  anchorWeight?: number;
  validFrom?: string;
  validTo?: string;
  createdAt: string;
};

export type HetangConversationSemanticStateDelta = {
  currentGoal?: string;
  currentLane?: "meta" | "query" | "analysis";
  lastIntentKind?: string;
  clarificationPending?: boolean;
  clarificationReason?: HetangConversationClarificationReason;
  anchoredSlots?: Record<string, unknown>;
  missingSlots?: string[];
  beliefState?: Record<string, unknown>;
  desireState?: Record<string, unknown>;
  intentionState?: Record<string, unknown>;
  lastRouteSnapshot?: Record<string, unknown>;
  confidence?: number;
  expiresAt?: string;
};

export type HetangSemanticExecutionEntry = "inbound" | "query";

export type HetangSemanticExecutionEntrySource =
  | "rule"
  | "rule_clarifier"
  | "ai_fallback"
  | "none";

export type HetangSemanticExecutionFailureClass =
  | "clarify_missing_store"
  | "clarify_missing_time"
  | "clarify_missing_metric"
  | "clarify_mixed_scope"
  | "clarify_missing_object_scope"
  | "generic_unmatched"
  | "entry_unresolved"
  | "semantic_failure"
  | "execution_failed"
  | "unsupported_customer_satisfaction"
  | "unsupported_schedule_detail"
  | "unsupported_forecast";

export type HetangSemanticExecutionAuditRecord = {
  auditId?: number;
  requestId?: string;
  entry: HetangSemanticExecutionEntry;
  entrySource?: HetangSemanticExecutionEntrySource;
  channel?: string;
  senderId?: string;
  conversationId?: string;
  rawText: string;
  effectiveText?: string;
  semanticLane?: "meta" | "query" | "analysis";
  intentKind?: string;
  capabilityId?: string;
  analysisFrameworkId?: string;
  analysisPersonaId?: string;
  routeUpgradeKind?: string;
  deployMarker?: string;
  servingVersion?: string;
  stateCarriedForward?: boolean;
  topicSwitchDetected?: boolean;
  clarificationNeeded: boolean;
  clarificationReason?: HetangConversationClarificationReason | string;
  fallbackUsed: boolean;
  executed: boolean;
  success: boolean;
  failureClass?: HetangSemanticExecutionFailureClass | string;
  durationMs?: number;
  occurredAt: string;
};

export type HetangSemanticExecutionAuditInput = Omit<
  HetangSemanticExecutionAuditRecord,
  "fallbackUsed" | "executed" | "success" | "clarificationNeeded"
> & {
  clarificationNeeded?: boolean;
  fallbackUsed?: boolean;
  executed?: boolean;
  success?: boolean;
};

export type HetangSemanticFailureClassCount = {
  failureClass: string;
  count: number;
};

export type HetangSemanticAnalysisFrameworkCount = {
  frameworkId: string;
  count: number;
};

export type HetangSemanticRouteUpgradeCount = {
  upgradeKind: string;
  count: number;
};

export type HetangSemanticOptimizationBacklogPriority = "high" | "medium" | "low";

export type HetangSemanticOptimizationSource = "semantic_execution" | "conversation_review";

export type HetangSemanticOptimizationBacklogItem = {
  source?: HetangSemanticOptimizationSource;
  failureClass: string;
  count: number;
  ownerModule: string;
  recommendedAction: string;
  priority: HetangSemanticOptimizationBacklogPriority;
};

export type HetangSemanticSampleCandidate = {
  source?: HetangSemanticOptimizationSource;
  failureClass: string;
  count: number;
  ownerModule: string;
  sampleTag: string;
  prompt: string;
};

export type HetangSemanticQualitySummary = {
  windowHours: number;
  totalCount: number;
  successCount: number;
  successRate: number | null;
  clarifyCount: number;
  clarifyRate: number | null;
  fallbackUsedCount: number;
  fallbackRate: number | null;
  latestOccurredAt?: string;
  topFailureClasses: HetangSemanticFailureClassCount[];
  topAnalysisFrameworks: HetangSemanticAnalysisFrameworkCount[];
  topRouteUpgrades: HetangSemanticRouteUpgradeCount[];
  optimizationBacklog: HetangSemanticOptimizationBacklogItem[];
  sampleCandidates: HetangSemanticSampleCandidate[];
  reviewBacklog?: HetangSemanticOptimizationBacklogItem[];
  reviewSampleCandidates?: HetangSemanticSampleCandidate[];
  reviewDeployFollowupCount?: number;
  fallbackConfig?: HetangSemanticFallbackObservability;
  carrySuccessCount?: number;
  carrySuccessRate?: number | null;
  topicSwitchCount?: number;
};

export type HetangSemanticFallbackObservabilityState = "off" | "unconfigured" | "on";

export type HetangSemanticFallbackObservability = {
  state: HetangSemanticFallbackObservabilityState;
  enabled: boolean;
  configured: boolean;
  model?: string;
  timeoutMs: number;
  autoAcceptConfidence: number;
  clarifyConfidence: number;
};

export type HetangAiLaneObservabilitySummary = {
  laneId: HetangAiLaneId;
  taskClass: HetangAiLaneTaskClass;
  executionMode: HetangAiLaneExecutionMode;
  ownerModule: string;
  observabilityLabel: string;
  model: string;
  reasoningMode: HetangAiLaneReasoningMode;
  timeoutMs: number;
  responseMode: HetangAiLaneResponseMode;
  fallbackBehavior: HetangAiLaneFallbackBehavior;
  fallbackLaneId?: HetangAiLaneId;
  overrideKeys: string[];
};

export type HetangConversationReviewRunStatus = "running" | "completed" | "failed";

export type HetangConversationReviewFindingType =
  | "intent_gap"
  | "scope_gap"
  | "permission_drift"
  | "capability_gap"
  | "reply_quality_issue"
  | "analysis_gap"
  | "memory_candidate";

export type HetangConversationReviewFindingSeverity = "low" | "medium" | "high";

export type HetangConversationReviewFindingStatus =
  | "open"
  | "acknowledged"
  | "resolved"
  | "dismissed";

export type HetangConversationReviewFollowupTarget =
  | "sample_candidate"
  | "backlog_candidate"
  | "deploy_followup_candidate";

export type HetangConversationReviewRun = {
  reviewRunId: string;
  reviewDate: string;
  sourceWindowStart: string;
  sourceWindowEnd: string;
  status: HetangConversationReviewRunStatus;
  inputConversationCount: number;
  inputShadowSampleCount: number;
  inputAnalysisJobCount: number;
  findingCount: number;
  summaryJson?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type HetangConversationReviewFinding = {
  findingId: string;
  reviewRunId: string;
  conversationId?: string;
  messageId?: string;
  jobId?: string;
  channel?: string;
  accountId?: string;
  chatId?: string;
  senderId?: string;
  orgId?: string;
  storeName?: string;
  findingType: HetangConversationReviewFindingType;
  severity: HetangConversationReviewFindingSeverity;
  confidence?: number;
  title: string;
  summary: string;
  evidenceJson: string;
  suggestedActionType?: string;
  suggestedActionPayloadJson?: string;
  followupTargets?: HetangConversationReviewFollowupTarget[];
  memoryCandidateJson?: string;
  status: HetangConversationReviewFindingStatus;
  createdAt: string;
  resolvedAt?: string;
};

export type HetangConversationReviewAnalysisSignal = {
  jobId: string;
  orgId?: string;
  storeName?: string;
  fallbackStage?: HetangBoundedAnalysisStage;
};

export type HetangConversationReviewCustomerProfileSignalType =
  | "missing_observation"
  | "stale_profile"
  | "low_hit_action";

export type HetangConversationReviewCustomerProfileSignal = {
  orgId?: string;
  storeName?: string;
  memberId?: string;
  customerIdentityKey: string;
  customerDisplayName?: string;
  signalType: HetangConversationReviewCustomerProfileSignalType;
  severity: HetangConversationReviewFindingSeverity;
  summary: string;
  evidenceJson: string;
};

export type HetangConversationReviewShadowSignal = {
  conversationId?: string;
  orgId?: string;
  storeName?: string;
  legacyLane?: string;
  semanticLane?: string;
  mismatchClass?: string;
};

export type HetangConversationReviewFindingCandidate = {
  conversationId?: string;
  messageId?: string;
  jobId?: string;
  channel?: string;
  accountId?: string;
  chatId?: string;
  senderId?: string;
  orgId?: string;
  storeName?: string;
  findingType: HetangConversationReviewFindingType;
  severity: HetangConversationReviewFindingSeverity;
  confidence?: number;
  title: string;
  summary: string;
  evidenceJson: string;
  suggestedActionType?: string;
  suggestedActionPayloadJson?: string;
  followupTargets?: HetangConversationReviewFollowupTarget[];
  memoryCandidateJson?: string;
};

export type HetangConversationReviewFindingCandidateSet = {
  findings: HetangConversationReviewFindingCandidate[];
};

export type HetangConversationReviewSummary = {
  reviewMode: "deterministic-only" | "bounded-synthesis";
  reviewDate: string;
  sourceWindowStart: string;
  sourceWindowEnd: string;
  inputConversationCount: number;
  inputShadowSampleCount: number;
  inputAnalysisJobCount: number;
  findingCount: number;
  topFindingTypes: HetangConversationReviewFindingType[];
  severityBreakdown: Record<HetangConversationReviewFindingSeverity, number>;
  reviewHeadline?: string;
  prioritizedFindingTypes?: HetangConversationReviewFindingType[];
};

export type HetangConversationReviewRunResult = {
  reviewRunId: string;
  reviewDate: string;
  sourceWindowStart: string;
  sourceWindowEnd: string;
  findingCount: number;
  summary: HetangConversationReviewSummary;
  findings: HetangConversationReviewFinding[];
};

export type HetangConversationReviewLatestSummary = {
  run: HetangConversationReviewRun;
  summary: HetangConversationReviewSummary | null;
  unresolvedHighSeverityFindings: HetangConversationReviewFinding[];
};

export type HetangConversationReviewSynthesis = {
  reviewHeadline?: string;
  prioritizedFindingTypes?: HetangConversationReviewFindingType[];
};

export type HetangConversationReviewFindingTypeCount = {
  findingType: HetangConversationReviewFindingType;
  count: number;
};

export type HetangConversationReviewSuggestedActionCount = {
  suggestedActionType: string;
  count: number;
};

export type HetangConversationReviewFollowupTargetCount = {
  followupTarget: HetangConversationReviewFollowupTarget;
  count: number;
};

export type HetangConversationReviewOverview = {
  latestRun: HetangConversationReviewRun | null;
  summary: HetangConversationReviewSummary | null;
  topFindingTypes: HetangConversationReviewFindingTypeCount[];
  suggestedActionCounts: HetangConversationReviewSuggestedActionCount[];
  followupTargetCounts: HetangConversationReviewFollowupTargetCount[];
  unresolvedHighSeverityFindings: HetangConversationReviewFinding[];
};

export type HetangCommandUsage = {
  hourlyCount: number;
  dailyCount: number;
};

export type HetangActionStatus =
  | "proposed"
  | "approved"
  | "rejected"
  | "executing"
  | "done"
  | "failed";

export type HetangActionPriority = "low" | "medium" | "high";

export type HetangActionSourceKind = "analysis" | "manual" | "report" | "query" | "learning";

export type HetangActionItem = {
  actionId: string;
  orgId: string;
  storeName?: string;
  bizDate?: string;
  category: string;
  title: string;
  priority: HetangActionPriority;
  status: HetangActionStatus;
  sourceKind: HetangActionSourceKind;
  sourceRef?: string;
  ownerName?: string;
  dueDate?: string;
  resultNote?: string;
  effectScore?: number;
  createdByChannel?: string;
  createdBySenderId?: string;
  createdByName?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type HetangLearningCategorySummary = {
  category: string;
  actionCount: number;
  averageEffectScore: number;
};

export type HetangAnalysisFallbackStageSummary = {
  stage: HetangBoundedAnalysisStage;
  count: number;
};

export type HetangLearningSummary = {
  orgId: string;
  storeName: string;
  totalActionCount: number;
  decidedActionCount: number;
  adoptedActionCount: number;
  rejectedActionCount: number;
  doneActionCount: number;
  failedActionCount: number;
  adoptionRate: number | null;
  completionRate: number | null;
  analysisJobCount: number;
  analysisCompletedCount: number;
  analysisFailedCount: number;
  analysisRetriedJobCount: number;
  analysisCompletionRate: number | null;
  analysisRetryRate: number | null;
  analysisAverageDurationMinutes: number | null;
  analysisFallbackCount: number;
  analysisFallbackRate: number | null;
  analysisFallbackStageBreakdown: HetangAnalysisFallbackStageSummary[];
  analysisAutoActionItemCount: number;
  analysisActionedJobCount: number;
  analysisActionConversionRate: number | null;
  analysisAverageActionsPerCompletedJob: number | null;
  topEffectiveCategories: HetangLearningCategorySummary[];
};

export type HetangControlTowerScopeType = "global" | "store";

export type HetangControlTowerSettingValue = boolean | number | string;

export type HetangControlTowerSettingRecord = {
  scopeType: HetangControlTowerScopeType;
  scopeKey: string;
  settingKey: string;
  value: HetangControlTowerSettingValue;
  updatedAt: string;
  updatedBy?: string;
};

export type HetangAnalysisJobType = "store_review";

export type HetangAnalysisJobStatus = "pending" | "running" | "completed" | "failed";

export type HetangAnalysisQueueDisposition =
  | "created"
  | "reused-pending"
  | "reused-running"
  | "reused-completed"
  | "retried";

export type HetangAnalysisJob = {
  jobId: string;
  jobType: HetangAnalysisJobType;
  capabilityId?: string;
  orgId: string;
  storeName?: string;
  rawText: string;
  timeFrameLabel: string;
  startBizDate: string;
  endBizDate: string;
  channel: string;
  target: string;
  accountId?: string;
  threadId?: string;
  senderId?: string;
  status: HetangAnalysisJobStatus;
  attemptCount: number;
  resultText?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  deliveredAt?: string;
  deliveryAttemptCount?: number;
  lastDeliveryAttemptAt?: string;
  lastDeliveryError?: string;
  nextDeliveryAfter?: string;
  deliveryAbandonedAt?: string;
  queueDisposition?: HetangAnalysisQueueDisposition;
};

export type HetangAnalysisEvidencePack = {
  packVersion: "v1";
  scopeType: "single_store" | "portfolio";
  orgIds: string[];
  storeName: string;
  question: string;
  timeFrameLabel: string;
  startBizDate: string;
  endBizDate: string;
  markdown: string;
  facts: Record<string, unknown>;
};

export type HetangBoundedAnalysisStage =
  | "evidence_pack"
  | "diagnostic_signals"
  | "orchestration_plan"
  | "bounded_synthesis"
  | "action_items";

export type HetangAnalysisOrchestrationStageStatus = "completed" | "fallback";

export type HetangAnalysisOrchestrationStageTrace = {
  stage: HetangBoundedAnalysisStage;
  status: HetangAnalysisOrchestrationStageStatus;
  detail: string;
};

export type HetangAnalysisOrchestrationMetadata = {
  version: "v1";
  completedStages: HetangBoundedAnalysisStage[];
  fallbackStage?: HetangBoundedAnalysisStage;
  signalCount?: number;
  stageTrace?: HetangAnalysisOrchestrationStageTrace[];
};

export type HetangAnalysisDiagnosticSeverity = "low" | "medium" | "high";

export type HetangAnalysisDiagnosticSignal = {
  signalId: string;
  severity: HetangAnalysisDiagnosticSeverity;
  title: string;
  finding: string;
  evidence: string[];
  recommendedFocus?: string;
};

export type HetangAnalysisDiagnosticBundle = {
  version: "v1";
  scopeType: HetangAnalysisEvidencePack["scopeType"];
  storeName: string;
  orgIds: string[];
  question: string;
  signals: HetangAnalysisDiagnosticSignal[];
};

export type HetangAnalysisSubscriber = {
  subscriberKey: string;
  jobId: string;
  channel: string;
  target: string;
  accountId?: string;
  threadId?: string;
  senderId?: string;
  createdAt: string;
  updatedAt: string;
  deliveredAt?: string;
  deliveryAttemptCount?: number;
  lastDeliveryAttemptAt?: string;
  lastDeliveryError?: string;
  nextDeliveryAfter?: string;
  deliveryAbandonedAt?: string;
};

export type HetangAnalysisDeliveryHealthSummary = {
  jobPendingCount: number;
  jobRetryingCount: number;
  jobAbandonedCount: number;
  subscriberPendingCount: number;
  subscriberRetryingCount: number;
  subscriberAbandonedCount: number;
};

export type HetangServicePollerName =
  | "scheduled-sync"
  | "scheduled-delivery"
  | "analysis";

export type HetangServicePollerHealth = {
  poller: HetangServicePollerName;
  status?: "ok" | "failed";
  lastRunAt?: string;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastDurationMs?: number;
  lastResultCount?: number;
  lastError?: string;
  lastLines?: string[];
};

export type HetangLegacyServicePollerHealth = {
  stateKey: string;
  poller?: string;
  status?: "ok" | "failed";
  lastRunAt?: string;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastDurationMs?: number;
  lastResultCount?: number;
  lastError?: string;
  lastLines?: string[];
};

export type HetangReportDeliveryUpgradeEvent = {
  orgId: string;
  storeName: string;
  bizDate: string;
  alertSentAt?: string;
  upgradedAt: string;
};

export type HetangReportDeliveryUpgradeSummary = {
  windowStartAt: string;
  recentUpgradeCount: number;
  recentUpgrades: HetangReportDeliveryUpgradeEvent[];
};

export type HetangDailyReportReadinessStoreStatus =
  | "ready"
  | "refresh-needed"
  | "incomplete"
  | "missing";

export type HetangDailyReportReadinessStore = {
  orgId: string;
  storeName: string;
  status: HetangDailyReportReadinessStoreStatus;
};

export type HetangDailyReportReadinessSummary = {
  bizDate: string;
  totalStoreCount: number;
  readyCount: number;
  refreshNeededCount: number;
  incompleteCount: number;
  missingCount: number;
  stores: HetangDailyReportReadinessStore[];
};

export type HetangIndustryContextReadinessStatus = "ready" | "refresh-needed" | "missing";

export type HetangIndustryContextModuleCoverage = {
  module: "hq_narrative" | "world_model" | "store_diagnosis";
  itemCount: number;
};

export type HetangIndustryContextReadinessSummary = {
  bizDate: string;
  status: HetangIndustryContextReadinessStatus;
  snapshotDate?: string;
  itemCount: number;
  freshnessDays?: number;
  moduleCoverage: HetangIndustryContextModuleCoverage[];
};

export type HetangEnvironmentMemoryStoreStatus =
  | "ready"
  | "missing"
  | "missing-holiday"
  | "missing-weather"
  | "fallback-only";

export type HetangEnvironmentMemoryStore = {
  orgId: string;
  storeName: string;
  status: HetangEnvironmentMemoryStoreStatus;
};

export type HetangEnvironmentMemoryDisturbanceHighlight = {
  orgId: string;
  storeName: string;
  bizDate: string;
  disturbanceLevel: Extract<EnvironmentDisturbanceLevel, "medium" | "high">;
  reasons: string[];
};

export type HetangEnvironmentMemoryDisturbanceSummary = {
  windowDays: number;
  mediumOrHigherCount: number;
  highDisturbanceCount: number;
  hintCount: number;
  mentionCount: number;
  highlights: HetangEnvironmentMemoryDisturbanceHighlight[];
};

export type HetangEnvironmentMemoryReadinessSummary = {
  bizDate: string;
  totalStoreCount: number;
  readyCount: number;
  missingCount: number;
  missingHolidayCount: number;
  missingWeatherCount: number;
  fallbackOnlyCount: number;
  highDisturbanceCount: number;
  stores: HetangEnvironmentMemoryStore[];
  recentDisturbance: HetangEnvironmentMemoryDisturbanceSummary;
};

export type HetangFiveStoreDailyOverviewStatus =
  | "disabled"
  | "waiting"
  | "ready"
  | "pending-confirm"
  | "cancelled"
  | "sent"
  | "failed";

export type HetangFiveStoreDailyOverviewSummary = {
  bizDate: string;
  status: HetangFiveStoreDailyOverviewStatus;
  totalStoreCount: number;
  readyCount: number;
  pendingStoreNames: string[];
  previewSentAt?: string;
  canceledAt?: string;
  canceledBy?: string;
  confirmedAt?: string;
  confirmedBy?: string;
  finalSentAt?: string;
  previewTarget?: HetangNotificationTarget;
  finalTarget?: HetangNotificationTarget;
};

export type HetangDailyReportAuditStatus = "healthy" | "warn";

export type HetangDailyReportAuditSampleDiff = {
  metricKey: string;
  status: string;
};

export type HetangDailyReportAuditSampleIssue = {
  orgId: string;
  storeName: string;
  bizDate: string;
  topDiffs: HetangDailyReportAuditSampleDiff[];
};

export type HetangDailyReportAuditSummary = {
  status: HetangDailyReportAuditStatus;
  endBizDate: string;
  windowDays: number;
  dates: string[];
  storeCount: number;
  checkedReports: number;
  reportsWithFreshMismatch: number;
  reportsWithStoredMismatch: number;
  reportsWithOnlyMissingStored: number;
  maxUnauditedMetricCount: number;
  unauditedKeys: string[];
  sampleIssues: HetangDailyReportAuditSampleIssue[];
  updatedAt?: string;
};

export type HetangSchedulerJobStatus = "disabled" | "waiting" | "pending" | "completed";

export type ScheduledJobOrchestrator = "sync" | "delivery";
export type ScheduledJobSurfaceRole = "primary" | "conditional";

export type HetangSchedulerJobSummary = {
  jobType: ScheduledJobType;
  label: string;
  orchestrator: ScheduledJobOrchestrator;
  surfaceRole: ScheduledJobSurfaceRole;
  surfaceNote?: string;
  schedule: string;
  enabled: boolean;
  runKey: string;
  due: boolean;
  completed: boolean;
  status: HetangSchedulerJobStatus;
  lastRanAt?: string;
};

export type HetangSchedulerStatusSummary = {
  authority: "app-service-pollers";
  contractVersion?: string;
  entrySurface?: {
    entryRole: "runtime_query_api";
    accessMode: "read_only";
    ownerSurface: "admin_read_service";
    auditMode: "none";
    requestDedupe: "none";
  };
  observabilityStreams?: Array<
    | "scheduler_snapshot"
    | "ai_lane_summary"
    | "report_delivery_upgrade_summary"
    | "daily_report_audit_summary"
    | "daily_report_readiness_summary"
    | "industry_context_summary"
    | "environment_memory_summary"
    | "five_store_daily_overview_summary"
    | "legacy_poller_warning"
  >;
  pollers: HetangServicePollerHealth[];
  jobs: HetangSchedulerJobSummary[];
  aiLanes?: HetangAiLaneObservabilitySummary[];
  legacyPollers?: HetangLegacyServicePollerHealth[];
  warnings?: string[];
  reportDeliveryUpgradeSummary?: HetangReportDeliveryUpgradeSummary;
  dailyReportAuditSummary?: HetangDailyReportAuditSummary;
  reportReadinessSummary?: HetangDailyReportReadinessSummary;
  industryContextSummary?: HetangIndustryContextReadinessSummary;
  environmentMemorySummary?: HetangEnvironmentMemoryReadinessSummary;
  fiveStoreDailyOverviewSummary?: HetangFiveStoreDailyOverviewSummary;
};

export type HetangAnalysisQueueSummary = {
  pendingCount: number;
  runningCount: number;
  completedCount: number;
  failedCount: number;
  jobDeliveryPendingCount: number;
  jobDeliveryRetryingCount: number;
  jobDeliveryAbandonedCount: number;
  subscriberDeliveryPendingCount: number;
  subscriberDeliveryRetryingCount: number;
  subscriberDeliveryAbandonedCount: number;
  unresolvedDeadLetterCount: number;
  deadLetterSummary?: HetangAnalysisDeadLetterSummary;
};

export type HetangAnalysisDeadLetterSummary = {
  unresolvedJobCount: number;
  unresolvedSubscriberCount: number;
  latestUnresolvedAt?: string;
  latestUnresolvedAgeHours?: number;
  stale?: boolean;
  latestReason?: string;
  invalidChatidSubscriberCount?: number;
  subscriberFanoutExhaustedJobCount?: number;
  residualClass?: "stale-invalid-chatid-subscriber";
};

export type HetangAnalysisDeadLetterCleanupResult = {
  residualClass: "stale-invalid-chatid-subscriber";
  cleanedSubscriberCount: number;
  cleanedJobCount: number;
  resolvedDeadLetterCount: number;
};

export type HetangQueueLaneSummary = {
  pendingCount: number;
  completedCount: number;
  waitingCount: number;
};

export type HetangSyncExecutionSummary = {
  runningCount: number;
  staleRunningCount: number;
  dailyRunningCount: number;
  staleDailyRunningCount: number;
  backfillRunningCount: number;
  staleBackfillRunningCount: number;
  latestStartedAt?: string;
  latestAgeHours?: number;
  staleCutoffAt?: string;
};

export type HetangQueueStatusSummary = {
  entrySurface?: {
    entryRole: "runtime_query_api";
    accessMode: "read_only";
    ownerSurface: "admin_read_service";
    auditMode: "none";
    requestDedupe: "none";
  };
  observabilityStreams?: Array<
    "queue_snapshot" | "analysis_dead_letter_summary" | "sync_execution_summary"
  >;
  sync: HetangQueueLaneSummary;
  delivery: HetangQueueLaneSummary;
  analysis: HetangAnalysisQueueSummary;
  syncExecution?: HetangSyncExecutionSummary;
};

export type HetangAnalysisDeadLetter = {
  deadLetterKey: string;
  jobId: string;
  orgId: string;
  deadLetterScope: "job" | "subscriber";
  reason: string;
  createdAt: string;
  subscriberKey?: string;
  payloadJson?: string;
  resolvedAt?: string;
};

export type HetangQuotaOverrides = {
  hourlyLimit?: number;
  dailyLimit?: number;
};

export type HetangOpsConfig = {
  timeZone: string;
  api: HetangApiConfig;
  sync: HetangSyncConfig;
  reporting: HetangReportingConfig;
  analysis: HetangAnalysisConfig;
  aiLanes: HetangAiLaneRegistryConfig;
  semanticFallback: HetangSemanticFallbackConfig;
  customerGrowthAi: HetangCustomerGrowthAiConfig;
  inboundLinkReaders: HetangInboundLinkReadersConfig;
  conversationQuality: HetangConversationQualityConfig;
  service: HetangServiceConfig;
  queue: HetangQueueConfig;
  database: HetangDatabaseConfig;
  stores: HetangStoreConfig[];
  externalIntelligence: HetangExternalIntelligenceConfig;
};

export type HetangExternalSourceTier = "s" | "a" | "b" | "blocked";

export type HetangExternalSourceDocumentScopeType = "hq" | "store";

export type HetangExternalSourceConfig = {
  sourceId: string;
  displayName?: string;
  tier: HetangExternalSourceTier;
  url?: string;
  notes?: string;
};

export type HetangExternalIntelligenceBriefComposition = {
  generalHotTopic: number;
  chainBrand: number;
  strategyPlatform: number;
};

export type HetangExternalIntelligenceDeliveryTarget = {
  channel: string;
  target: string;
  accountId?: string;
  threadId?: string;
};

export type HetangExternalIntelligenceConfig = {
  enabled: boolean;
  freshnessHours: number;
  maxItemsPerIssue: number;
  briefComposition: HetangExternalIntelligenceBriefComposition;
  hqDelivery: HetangExternalIntelligenceDeliveryTarget;
  sources: HetangExternalSourceConfig[];
};

export type HetangExternalEventCandidate = {
  candidateId: string;
  sourceId: string;
  title: string;
  summary: string;
  entity: string;
  action: string;
  object?: string;
  theme: string;
  publishedAt: string;
  eventAt?: string;
  tier: HetangExternalSourceTier;
  score: number;
  blockedReason?: string;
  normalizedKey: string;
};

export type HetangExternalEventCard = {
  cardId: string;
  entity: string;
  action: string;
  object?: string;
  theme: string;
  eventAt?: string;
  publishedAt: string;
  sources: HetangExternalSourceConfig[];
  summary: string;
  score: number;
};

export type HetangExternalBriefItem = {
  itemId: string;
  cardId: string;
  title: string;
  theme: string;
  summary: string;
  whyItMatters: string;
  score: number;
  rank: number;
};

export type HetangExternalBriefIssue = {
  issueId: string;
  issueDate: string;
  createdAt: string;
  items: HetangExternalBriefItem[];
  topic: string;
};

export type HetangStoreExternalContextTruthLevel =
  | "confirmed"
  | "estimated"
  | "research_note";

export type OperatingWorldSourceCategory =
  | "internal_fact"
  | "derived_intelligence"
  | "external_context"
  | "environment_context"
  | "execution_feedback"
  | "industry_signal";

export type OperatingWorldTruthBoundary = "hard_fact" | "soft_fact" | "weak_signal";

export type HetangStoreExternalContextKind =
  | "store_business_profile"
  | "estimated_market_context"
  | "research_note";

export type HetangStoreExternalContextConfidence = "high" | "medium" | "low";

export type HetangStoreExternalContextEntry = {
  orgId: string;
  snapshotDate: string;
  contextKind: HetangStoreExternalContextKind;
  metricKey: string;
  valueText?: string;
  valueNum?: number;
  valueJson?: unknown;
  unit?: string;
  truthLevel: HetangStoreExternalContextTruthLevel;
  confidence: HetangStoreExternalContextConfidence;
  sourceType: string;
  sourceLabel?: string;
  sourceUri?: string;
  applicableModules: string[];
  notForScoring: boolean;
  note?: string;
  rawJson: string;
  updatedAt: string;
};

export type HetangStoreParkingConvenienceLevel = "high" | "medium" | "low" | "unknown";

export type HetangStoreOperatingStatus =
  | "planning"
  | "trial"
  | "operating"
  | "renovating"
  | "closed";

export type HetangStoreServiceHoursWindow = {
  label?: string;
  weekdays?: string[];
  start: string;
  end: string;
  overnight?: boolean;
};

export type HetangStoreServiceHours = {
  windows: HetangStoreServiceHoursWindow[];
  timeZone?: string;
  notes?: string[];
};

export type HetangStoreMasterProfile = {
  orgId: string;
  storeName: string;
  brandName?: string;
  cityName?: string;
  districtName?: string;
  addressText?: string;
  longitude?: number;
  latitude?: number;
  openingDate?: string;
  renovationDate?: string;
  areaM2?: number;
  roomCountTotal?: number;
  roomMixJson?: Record<string, unknown>;
  serviceHoursJson?: HetangStoreServiceHours | Record<string, unknown>;
  storeFormat?: string;
  businessScene?: string;
  parkingAvailable?: boolean;
  parkingConvenienceLevel?: HetangStoreParkingConvenienceLevel;
  operatingStatus?: HetangStoreOperatingStatus;
  sourceLabel?: string;
  verifiedAt?: string;
  rawJson?: string;
  updatedAt: string;
};

export type HetangStoreMasterProfileSnapshot = HetangStoreMasterProfile & {
  snapshotDate: string;
  snapshotCapturedAt: string;
};

export type HetangStoreLifecycleStage = "new" | "growing" | "mature" | "veteran" | "unknown";

export type HetangStoreScaleBand = "small" | "medium" | "large" | "flagship" | "unknown";

export type HetangStoreCapacityPrior = "low" | "medium" | "high" | "very_high" | "unknown";

export type HetangStoreMasterDerivedFeatures = {
  orgId: string;
  storeName: string;
  asOfDate: string;
  storeAgeMonths: number | null;
  lifecycleStage: HetangStoreLifecycleStage;
  serviceWindowHours: number | null;
  nightWindowHours: number | null;
  lateNightCapable: boolean;
  storeScaleBand: HetangStoreScaleBand;
  capacityPrior: HetangStoreCapacityPrior;
};

export type HetangIndustryContextSignalKind =
  | "industry_climate"
  | "platform_rule"
  | "city_consumption_trend"
  | "capital_market_note";

export type HetangIndustryContextSnapshotRecord = {
  snapshotDate: string;
  signalKind: HetangIndustryContextSignalKind;
  signalKey: string;
  title: string;
  summary: string;
  detailJson?: unknown;
  truthBoundary: OperatingWorldTruthBoundary;
  confidence: HetangStoreExternalContextConfidence;
  sourceType: string;
  sourceLabel?: string;
  sourceUri?: string;
  applicableModules: string[];
  note?: string;
  rawJson: string;
  updatedAt: string;
};




export const CUSTOMER_OBSERVATION_TRUTH_BOUNDARIES = [
  "hard_fact",
  "observed_fact",
  "inferred_label",
  "predicted_signal",
] as const;

export type CustomerObservationTruthBoundary =
  (typeof CUSTOMER_OBSERVATION_TRUTH_BOUNDARIES)[number];

export const CUSTOMER_OBSERVATION_SOURCE_TYPES = [
  "self_reported",
  "staff_observed",
  "system_fact",
  "system_inferred",
] as const;

export type CustomerObservationSourceType = (typeof CUSTOMER_OBSERVATION_SOURCE_TYPES)[number];

export const CUSTOMER_OBSERVATION_SOURCE_ROLES = [
  "technician",
  "front_desk",
  "customer_service",
  "store_manager",
  "system",
] as const;

export type CustomerObservationSourceRole = (typeof CUSTOMER_OBSERVATION_SOURCE_ROLES)[number];

export const CUSTOMER_OPERATING_SCORING_SCOPES = ["none", "action_only", "profile_allowed"] as const;

export type CustomerOperatingScoringScope = (typeof CUSTOMER_OPERATING_SCORING_SCOPES)[number];

export const CUSTOMER_SERVICE_OBSERVATION_BATCH_STATUSES = [
  "captured",
  "normalized",
  "published",
  "failed",
] as const;

export type CustomerServiceObservationBatchStatus =
  (typeof CUSTOMER_SERVICE_OBSERVATION_BATCH_STATUSES)[number];

export type CustomerServiceObservationBatch = {
  batchId: string;
  orgId: string;
  sourceRole: CustomerObservationSourceRole;
  collectionSurface: string;
  captureMode: string;
  capturedAt: string;
  operatorId?: string;
  status: CustomerServiceObservationBatchStatus;
  rawManifestJson: string;
};

export type CustomerServiceObservationRecord = {
  observationId: string;
  orgId: string;
  memberId?: string;
  customerIdentityKey: string;
  sourceRole: CustomerObservationSourceRole;
  sourceType: CustomerObservationSourceType;
  observerId?: string;
  batchId?: string;
  signalDomain: string;
  signalKey: string;
  valueNum?: number;
  valueText?: string;
  valueJson?: unknown;
  confidence: HetangStoreExternalContextConfidence;
  truthBoundary: CustomerObservationTruthBoundary;
  observedAt: string;
  validTo?: string;
  rawNote?: string;
  rawJson: string;
  updatedAt: string;
};

export type CustomerOperatingSignalRecord = {
  signalId: string;
  orgId: string;
  memberId?: string;
  customerIdentityKey: string;
  signalDomain: string;
  signalKey: string;
  valueNum?: number;
  valueText?: string;
  valueJson?: unknown;
  confidence: HetangStoreExternalContextConfidence;
  truthBoundary: CustomerObservationTruthBoundary;
  scoringScope: CustomerOperatingScoringScope;
  sourceObservationIds: string[];
  supportCount: number;
  observedAt: string;
  validTo?: string;
  updatedAt: string;
};

export type CustomerOperatingProfileDailyRecord = {
  orgId: string;
  bizDate: string;
  memberId?: string;
  customerIdentityKey: string;
  customerDisplayName: string;
  identityProfileJson: Record<string, unknown>;
  spendingProfileJson: Record<string, unknown>;
  serviceNeedProfileJson: Record<string, unknown>;
  interactionProfileJson: Record<string, unknown>;
  preferenceProfileJson: Record<string, unknown>;
  scenarioProfileJson: Record<string, unknown>;
  relationshipProfileJson: Record<string, unknown>;
  opportunityProfileJson: Record<string, unknown>;
  sourceSignalIds: string[];
  updatedAt: string;
};

export type HetangStoreExternalObservationBatchStatus =
  | "captured"
  | "normalized"
  | "published"
  | "failed";

export type HetangStoreExternalObservationBatch = {
  batchId: string;
  orgId: string;
  sourcePlatform: string;
  captureScope: string;
  captureMode: string;
  capturedAt: string;
  operatorId?: string;
  browserProfileId?: string;
  status: HetangStoreExternalObservationBatchStatus;
  rawManifestJson: string;
};

export type HetangStoreExternalObservation = {
  observationId: string;
  orgId: string;
  snapshotDate: string;
  sourcePlatform: string;
  metricDomain: string;
  metricKey: string;
  valueNum?: number;
  valueText?: string;
  valueJson?: unknown;
  unit?: string;
  truthLevel: HetangStoreExternalContextTruthLevel;
  confidence: HetangStoreExternalContextConfidence;
  sourceLabel?: string;
  sourceUri?: string;
  batchId?: string;
  evidenceDocumentId?: string;
  applicableModules: string[];
  notForScoring: boolean;
  validFrom?: string;
  validTo?: string;
  rawJson: string;
  updatedAt: string;
};

export type EndpointCode = "1.1" | "1.2" | "1.3" | "1.4" | "1.5" | "1.6" | "1.7" | "1.8";

export type SyncWindow = {
  start: Date;
  end: Date;
  startTime: string;
  endTime: string;
};

export type ScheduledJobType =
  | "sync"
  | "nightly-history-backfill"
  | "nightly-conversation-review"
  | "run-customer-history-catchup"
  | "build-store-environment-memory"
  | "build-report"
  | "audit-daily-report-window"
  | "send-report"
  | "send-five-store-daily-overview"
  | "send-weekly-report"
  | "send-monthly-report"
  | "send-weekly-chart"
  | "send-midday-brief"
  | "send-reactivation-push"
  | "build-external-brief";

export type ScheduledJob = {
  jobType: ScheduledJobType;
  runKey: string;
};

export type MemberCurrentRecord = {
  orgId: string;
  memberId: string;
  name: string;
  phone?: string;
  storedAmount: number;
  consumeAmount: number;
  createdTime?: string;
  lastConsumeTime?: string;
  silentDays: number;
  rawStoreName?: string;
  rawJson: string;
};

export type MemberDailySnapshotRecord = MemberCurrentRecord & {
  bizDate: string;
};

export type MemberCardDailySnapshotRecord = MemberCardCurrentRecord & {
  bizDate: string;
};

export type StoreManagerDailyKpiRow = {
  bizDate: string;
  orgId: string;
  storeName: string;
  dailyActualRevenue: number;
  dailyCardConsume: number;
  dailyOrderCount: number;
  totalClocks: number;
  assignClocks: number;
  queueClocks: number;
  pointClockRate: number | null;
  averageTicket: number | null;
  clockEffect: number | null;
};

export type TechProfile30dRow = {
  orgId: string;
  windowEndBizDate: string;
  techCode: string;
  techName: string;
  servedCustomerCount30d: number;
  servedOrderCount30d: number;
  serviceDayCount30d: number;
  totalClockCount30d: number;
  pointClockCount30d: number;
  queueClockCount30d: number;
  pointClockRate30d: number | null;
  addClockRate30d: number | null;
  turnover30d: number;
  commission30d: number;
  marketRevenue30d: number;
  activeDays30d: number;
};

export type StoreReview7dRow = {
  orgId: string;
  windowEndBizDate: string;
  storeName: string;
  revenue7d: number;
  orderCount7d: number;
  customerCount7d: number;
  totalClocks7d: number;
  clockEffect7d: number | null;
  averageTicket7d: number | null;
  pointClockRate7d: number | null;
  addClockRate7d: number | null;
  rechargeCash7d: number;
  storedConsumeAmount7d: number;
  storedConsumeRate7d: number | null;
  onDutyTechCount7d: number | null;
  groupbuyOrderShare7d: number | null;
  groupbuyCohortCustomerCount: number;
  groupbuy7dRevisitCustomerCount: number;
  groupbuy7dRevisitRate: number | null;
  groupbuy7dCardOpenedCustomerCount: number;
  groupbuy7dCardOpenedRate: number | null;
  groupbuy7dStoredValueConvertedCustomerCount: number;
  groupbuy7dStoredValueConversionRate: number | null;
  groupbuy30dMemberPayConvertedCustomerCount: number;
  groupbuy30dMemberPayConversionRate: number | null;
  groupbuyFirstOrderCustomerCount: number;
  groupbuyFirstOrderHighValueMemberCustomerCount: number;
  groupbuyFirstOrderHighValueMemberRate: number | null;
  effectiveMembers: number;
  sleepingMembers: number;
  sleepingMemberRate: number | null;
  newMembers7d: number;
  activeTechCount7d: number | null;
  currentStoredBalance?: number;
  storedBalanceLifeMonths?: number | null;
  renewalPressureIndex30d?: number | null;
  memberRepurchaseBaseCustomerCount7d?: number;
  memberRepurchaseReturnedCustomerCount7d?: number;
  memberRepurchaseRate7d?: number | null;
};

export type StoreSummary30dRow = {
  orgId: string;
  windowEndBizDate: string;
  storeName: string;
  revenue30d: number;
  orderCount30d: number;
  customerCount30d: number;
  totalClocks30d: number;
  clockEffect30d: number | null;
  averageTicket30d: number | null;
  pointClockRate30d: number | null;
  addClockRate30d: number | null;
  rechargeCash30d: number;
  storedConsumeAmount30d: number;
  storedConsumeRate30d: number | null;
  onDutyTechCount30d: number | null;
  groupbuyOrderShare30d: number | null;
  groupbuyCohortCustomerCount: number;
  groupbuy7dRevisitCustomerCount: number;
  groupbuy7dRevisitRate: number | null;
  groupbuy7dCardOpenedCustomerCount: number;
  groupbuy7dCardOpenedRate: number | null;
  groupbuy7dStoredValueConvertedCustomerCount: number;
  groupbuy7dStoredValueConversionRate: number | null;
  groupbuy30dMemberPayConvertedCustomerCount: number;
  groupbuy30dMemberPayConversionRate: number | null;
  groupbuyFirstOrderCustomerCount: number;
  groupbuyFirstOrderHighValueMemberCustomerCount: number;
  groupbuyFirstOrderHighValueMemberRate: number | null;
  effectiveMembers: number;
  sleepingMembers: number;
  sleepingMemberRate: number | null;
  newMembers30d: number;
  activeTechCount30d: number | null;
  currentStoredBalance?: number;
  storedBalanceLifeMonths?: number | null;
  renewalPressureIndex30d?: number | null;
  memberRepurchaseBaseCustomerCount7d?: number;
  memberRepurchaseReturnedCustomerCount7d?: number;
  memberRepurchaseRate7d?: number | null;
};

export type MemberCardCurrentRecord = {
  orgId: string;
  memberId: string;
  cardId: string;
  cardNo?: string;
  rawJson: string;
};

export type ConsumeBillRecord = {
  orgId: string;
  settleId: string;
  settleNo?: string;
  payAmount: number;
  consumeAmount: number;
  discountAmount: number;
  antiFlag: boolean;
  optTime: string;
  bizDate: string;
  rawJson: string;
};

export type RechargeBillRecord = {
  orgId: string;
  rechargeId: string;
  realityAmount: number;
  totalAmount: number;
  donateAmount: number;
  antiFlag: boolean;
  optTime: string;
  bizDate: string;
  rawJson: string;
};

export type UserTradeRecord = {
  orgId: string;
  rowFingerprint: string;
  tradeNo?: string;
  optTime: string;
  bizDate: string;
  cardOptType?: string;
  changeBalance: number;
  changeReality: number;
  changeDonate: number;
  changeIntegral: number;
  paymentType?: string;
  antiFlag: boolean;
  rawJson: string;
};

export type TechCurrentRecord = {
  orgId: string;
  techCode: string;
  techName: string;
  isWork: boolean;
  isJob: boolean;
  pointClockNum: number;
  wheelClockNum: number;
  baseWages: number;
  rawStoreName?: string;
  rawJson: string;
};

export type TechUpClockRecord = {
  orgId: string;
  rowFingerprint: string;
  personCode: string;
  personName: string;
  settleNo?: string;
  handCardCode?: string;
  itemName?: string;
  clockType?: string;
  count: number;
  turnover: number;
  comm: number;
  ctime?: string;
  settleTime?: string;
  bizDate: string;
  rawJson: string;
};

export type TechMarketRecord = {
  orgId: string;
  recordKey: string;
  marketId?: string;
  settleNo?: string;
  handCardCode?: string;
  roomCode?: string;
  personCode?: string;
  personName?: string;
  itemId?: string;
  itemName?: string;
  itemTypeName?: string;
  itemCategory?: number;
  salesCode?: string;
  salesName?: string;
  count: number;
  afterDisc: number;
  commission: number;
  settleTime?: string;
  bizDate: string;
  rawJson: string;
};

export type TechCommissionSnapshotRecord = {
  bizDate: string;
  orgId: string;
  itemId: string;
  itemName?: string;
  ruleHash: string;
  rawJson: string;
};

export type TechLeaderboardRow = {
  personCode: string;
  personName: string;
  totalClockCount: number;
  upClockRecordCount: number;
  pointClockRecordCount: number;
  pointClockRate: number | null;
  addClockRecordCount: number;
  addClockRate: number | null;
  turnover: number;
  commission: number;
  commissionRate: number | null;
  clockEffect: number | null;
  marketRevenue: number;
  marketCommission: number;
};

export type ConsumeCustomerRef = {
  displayName?: string;
  memberLabel?: string;
  referenceCode?: string;
  infoText: string;
};

export type CustomerIdentityType = "member" | "customer-ref" | "display-name" | "settle-local";

export type CustomerTechLinkConfidence =
  | "single-customer"
  | "single-tech"
  | "order-level-ambiguous";

export type CustomerTechLinkRecord = {
  orgId: string;
  bizDate: string;
  settleId: string;
  settleNo?: string;
  customerIdentityKey: string;
  customerIdentityType: CustomerIdentityType;
  customerDisplayName: string;
  memberId?: string;
  memberCardNo?: string;
  referenceCode?: string;
  memberLabel?: string;
  identityStable: boolean;
  techCode: string;
  techName: string;
  customerCountInSettle: number;
  techCountInSettle: number;
  techTurnover: number;
  techCommission: number;
  orderPayAmount: number;
  orderConsumeAmount: number;
  itemNames: string[];
  linkConfidence: CustomerTechLinkConfidence;
  rawJson: string;
};

export type CustomerRecencySegment =
  | "active-7d"
  | "active-30d"
  | "silent-31-90d"
  | "sleeping-91-180d"
  | "lost-180d-plus";

export type CustomerFrequencySegment = "high-4-plus" | "medium-2-3" | "low-1" | "none";

export type CustomerMonetarySegment = "high-1000-plus" | "medium-300-999" | "low-1-299" | "none";

export type CustomerPaymentSegment =
  | "member-only"
  | "groupbuy-only"
  | "mixed-member-nonmember"
  | "groupbuy-plus-direct"
  | "direct-only"
  | "unknown";

export type CustomerTechLoyaltySegment = "single-tech-loyal" | "multi-tech" | "no-tech-link";

export type CustomerPrimarySegment =
  | "important-value-member"
  | "important-reactivation-member"
  | "potential-growth-customer"
  | "groupbuy-retain-candidate"
  | "active-member"
  | "sleeping-customer"
  | "standard-customer"
  | "unstable-identity";

export type CustomerSegmentRecord = {
  orgId: string;
  bizDate: string;
  customerIdentityKey: string;
  customerIdentityType: CustomerIdentityType;
  customerDisplayName: string;
  memberId?: string;
  memberCardNo?: string;
  referenceCode?: string;
  memberLabel?: string;
  identityStable: boolean;
  segmentEligible: boolean;
  firstBizDate?: string;
  lastBizDate?: string;
  daysSinceLastVisit: number;
  visitCount30d: number;
  visitCount90d: number;
  payAmount30d: number;
  payAmount90d: number;
  memberPayAmount90d: number;
  groupbuyAmount90d: number;
  directPayAmount90d: number;
  distinctTechCount90d: number;
  topTechCode?: string;
  topTechName?: string;
  topTechVisitCount90d: number;
  topTechVisitShare90d: number | null;
  recencySegment: CustomerRecencySegment;
  frequencySegment: CustomerFrequencySegment;
  monetarySegment: CustomerMonetarySegment;
  paymentSegment: CustomerPaymentSegment;
  techLoyaltySegment: CustomerTechLoyaltySegment;
  primarySegment: CustomerPrimarySegment;
  tagKeys: string[];
  rawJson: string;
};

export type CustomerConversionCohortRecord = {
  orgId: string;
  bizDate: string;
  customerIdentityKey: string;
  customerIdentityType: CustomerIdentityType;
  customerDisplayName: string;
  memberId?: string;
  memberCardNo?: string;
  referenceCode?: string;
  identityStable: boolean;
  firstGroupbuyBizDate?: string;
  firstGroupbuyOptTime?: string;
  firstGroupbuySettleId?: string;
  firstGroupbuySettleNo?: string;
  firstGroupbuyAmount: number;
  firstObservedBizDate?: string;
  lastObservedBizDate?: string;
  firstObservedIsGroupbuy: boolean;
  revisitWithin7d: boolean;
  revisitWithin30d: boolean;
  cardOpenedWithin7d: boolean;
  storedValueConvertedWithin7d: boolean;
  memberPayConvertedWithin30d: boolean;
  visitCount30dAfterGroupbuy: number;
  payAmount30dAfterGroupbuy: number;
  memberPayAmount30dAfterGroupbuy: number;
  highValueMemberWithin30d: boolean;
  rawJson: string;
};

export type CustomerProfile90dRow = {
  orgId: string;
  windowEndBizDate: string;
  customerIdentityKey: string;
  customerIdentityType: CustomerIdentityType;
  customerDisplayName: string;
  memberId?: string;
  memberCardNo?: string;
  referenceCode?: string;
  memberLabel?: string;
  phone?: string;
  identityStable: boolean;
  segmentEligible: boolean;
  firstBizDate?: string;
  lastBizDate?: string;
  daysSinceLastVisit: number;
  visitCount30d: number;
  visitCount90d: number;
  payAmount30d: number;
  payAmount90d: number;
  memberPayAmount90d: number;
  groupbuyAmount90d: number;
  directPayAmount90d: number;
  distinctTechCount90d: number;
  topTechCode?: string;
  topTechName?: string;
  topTechVisitCount90d: number;
  topTechVisitShare90d: number | null;
  recencySegment: CustomerRecencySegment;
  frequencySegment: CustomerFrequencySegment;
  monetarySegment: CustomerMonetarySegment;
  paymentSegment: CustomerPaymentSegment;
  techLoyaltySegment: CustomerTechLoyaltySegment;
  primarySegment: CustomerPrimarySegment;
  tagKeys: string[];
  currentStoredAmount: number;
  currentConsumeAmount: number;
  currentCreatedTime?: string;
  currentLastConsumeTime?: string;
  currentSilentDays: number;
  firstGroupbuyBizDate?: string;
  revisitWithin7d: boolean;
  revisitWithin30d: boolean;
  cardOpenedWithin7d: boolean;
  storedValueConvertedWithin7d: boolean;
  memberPayConvertedWithin30d: boolean;
  highValueMemberWithin30d: boolean;
};

export type EnvironmentSeasonTag = "spring" | "summer" | "autumn" | "winter";
export type EnvironmentHolidayTag =
  | "workday"
  | "adjusted_workday"
  | "weekend"
  | "holiday"
  | "pre_holiday"
  | "post_holiday";
export type EnvironmentWeatherTag = "clear" | "cloudy" | "rain" | "storm" | "snow" | "unknown";
export type EnvironmentTemperatureBand = "cold" | "cool" | "mild" | "warm" | "hot" | "unknown";
export type EnvironmentPrecipitationTag = "none" | "light" | "moderate" | "heavy" | "unknown";
export type EnvironmentWindTag = "low" | "medium" | "high" | "unknown";
export type EnvironmentSolarTerm =
  | "xiaohan"
  | "dahan"
  | "lichun"
  | "yushui"
  | "jingzhe"
  | "chunfen"
  | "qingming"
  | "guyu"
  | "lixia"
  | "xiaoman"
  | "mangzhong"
  | "xiazhi"
  | "xiaoshu"
  | "dashu"
  | "liqiu"
  | "chushu"
  | "bailu"
  | "qiufen"
  | "hanlu"
  | "shuangjiang"
  | "lidong"
  | "xiaoxue"
  | "daxue"
  | "dongzhi";
export type EnvironmentBiasLevel = "low" | "medium" | "high";
export type EnvironmentPenaltyLevel = "none" | "low" | "medium" | "high";
export type EnvironmentDisturbanceLevel = "none" | "low" | "medium" | "high";
export type EnvironmentNarrativePolicy = "suppress" | "hint" | "mention";

export type EnvironmentContextSnapshot = {
  orgId?: string;
  bizDate: string;
  cityCode?: string;
  weekdayIndex?: number;
  weekdayLabel?: string;
  seasonTag?: EnvironmentSeasonTag;
  monthTag?: string;
  solarTerm?: EnvironmentSolarTerm;
  isWeekend?: boolean;
  holidayTag?: EnvironmentHolidayTag;
  holidayName?: string;
  isAdjustedWorkday?: boolean;
  weatherConditionRaw?: string;
  temperatureC?: number | null;
  precipitationMm?: number | null;
  windLevel?: number | null;
  weatherTag?: EnvironmentWeatherTag;
  temperatureBand?: EnvironmentTemperatureBand;
  precipitationTag?: EnvironmentPrecipitationTag;
  windTag?: EnvironmentWindTag;
  citySeasonalPattern?: string;
  nightlifeSeasonality?: string;
  postDinnerLeisureBias?: EnvironmentBiasLevel;
  eveningOutingLikelihood?: EnvironmentBiasLevel;
  badWeatherTouchPenalty?: EnvironmentPenaltyLevel;
  environmentDisturbanceLevel?: EnvironmentDisturbanceLevel;
  narrativePolicy?: EnvironmentNarrativePolicy;
  contextJson?: string;
};

export type ChinaHolidayCalendarDayRecord = {
  bizDate: string;
  holidayTag: EnvironmentHolidayTag;
  holidayName?: string;
  isAdjustedWorkday: boolean;
  sourceVersion?: string;
  sourceLabel?: string;
  rawJson?: string;
  updatedAt: string;
};

export type StoreEnvironmentDailySnapshotRecord = EnvironmentContextSnapshot & {
  orgId: string;
  bizDate: string;
  snapshotJson: string;
  sourceJson?: string;
  collectedAt: string;
  updatedAt: string;
};

export type MemberReactivationFeatureRecord = {
  orgId: string;
  bizDate: string;
  memberId: string;
  customerIdentityKey: string;
  customerDisplayName: string;
  memberCardNo?: string;
  referenceCode?: string;
  primarySegment: CustomerPrimarySegment;
  daysSinceLastVisit: number;
  visitCount30d: number;
  visitCount90d: number;
  payAmount30d: number;
  payAmount90d: number;
  memberPayAmount30d: number;
  memberPayAmount90d: number;
  rechargeTotal30d: number;
  rechargeTotal90d: number;
  rechargeCount30d: number;
  rechargeCount90d: number;
  daysSinceLastRecharge: number | null;
  currentStoredBalanceInferred: number;
  storedBalance7dAgo: number | null;
  storedBalance30dAgo: number | null;
  storedBalance90dAgo: number | null;
  storedBalanceDelta7d: number | null;
  storedBalanceDelta30d: number | null;
  storedBalanceDelta90d: number | null;
  depletionVelocity30d: number | null;
  projectedBalanceDaysLeft: number | null;
  rechargeToMemberPayRatio90d: number | null;
  dominantVisitDaypart: string | null;
  preferredDaypartShare90d: number | null;
  dominantVisitWeekday: string | null;
  preferredWeekdayShare90d: number | null;
  dominantVisitMonthPhase: string | null;
  preferredMonthPhaseShare90d: number | null;
  weekendVisitShare90d: number | null;
  lateNightVisitShare90d: number | null;
  overnightVisitShare90d: number | null;
  averageVisitGapDays90d: number | null;
  visitGapStddevDays90d: number | null;
  cycleDeviationScore: number | null;
  timePreferenceConfidenceScore: number;
  trajectoryConfidenceScore: number;
  reactivationPriorityScore: number;
  featureJson: string;
};

export type MemberReactivationChurnRiskLabel = "critical" | "high" | "medium" | "low";

export type MemberReactivationRevisitWindowLabel =
  | "due-now"
  | "due-this-week"
  | "later-this-month"
  | "not-due";

export type MemberReactivationTouchWindowLabel =
  | "best-today"
  | "best-this-week"
  | "wait-preferred-weekday"
  | "low-confidence";

export type MemberReactivationLifecycleMomentumLabel =
  | "accelerating"
  | "stable"
  | "cooling"
  | "stalled";

export type MemberReactivationActionLabel =
  | "immediate-1to1"
  | "scheduled-reactivation"
  | "growth-nurture"
  | "observe";

export type MemberReactivationStrategyRecord = {
  orgId: string;
  bizDate: string;
  memberId: string;
  customerIdentityKey: string;
  customerDisplayName: string;
  primarySegment: CustomerPrimarySegment;
  reactivationPriorityScore: number;
  churnRiskScore: number;
  churnRiskLabel: MemberReactivationChurnRiskLabel;
  revisitProbability7d: number;
  revisitWindowLabel: MemberReactivationRevisitWindowLabel;
  recommendedTouchWeekday: string | null;
  recommendedTouchDaypart: string | null;
  touchWindowMatchScore: number;
  touchWindowLabel: MemberReactivationTouchWindowLabel;
  lifecycleMomentumScore: number;
  lifecycleMomentumLabel: MemberReactivationLifecycleMomentumLabel;
  recommendedActionLabel: MemberReactivationActionLabel;
  strategyPriorityScore: number;
  strategyJson: string;
};

export type MemberReactivationFollowupBucket =
  | "high-value-reactivation"
  | "potential-growth"
  | "groupbuy-retention";

export type MemberReactivationPriorityBand = "P0" | "P1" | "P2" | "P3";

export type MemberReactivationQueueRecord = {
  orgId: string;
  bizDate: string;
  memberId: string;
  customerIdentityKey: string;
  customerDisplayName: string;
  memberCardNo?: string;
  referenceCode?: string;
  primarySegment: CustomerPrimarySegment;
  followupBucket: MemberReactivationFollowupBucket;
  reactivationPriorityScore: number;
  strategyPriorityScore: number;
  executionPriorityScore: number;
  priorityBand: MemberReactivationPriorityBand;
  priorityRank: number;
  churnRiskLabel: MemberReactivationChurnRiskLabel;
  churnRiskScore: number;
  revisitWindowLabel: MemberReactivationRevisitWindowLabel;
  recommendedActionLabel: MemberReactivationActionLabel;
  recommendedTouchWeekday: string | null;
  recommendedTouchDaypart: string | null;
  touchWindowLabel: MemberReactivationTouchWindowLabel;
  reasonSummary: string;
  touchAdviceSummary: string;
  daysSinceLastVisit: number;
  visitCount90d: number;
  payAmount90d: number;
  currentStoredBalanceInferred: number;
  projectedBalanceDaysLeft: number | null;
  birthdayMonthDay?: string | null;
  nextBirthdayBizDate?: string | null;
  birthdayWindowDays?: number | null;
  birthdayBoostScore: number;
  topTechName?: string | null;
  queueJson: string;
  updatedAt: string;
};

export type MemberReactivationFeedbackStatus =
  | "pending"
  | "contacted"
  | "replied"
  | "booked"
  | "arrived"
  | "closed";

export type MemberReactivationFeedbackRecord = {
  orgId: string;
  bizDate: string;
  memberId: string;
  feedbackStatus: MemberReactivationFeedbackStatus;
  followedBy?: string;
  followedAt?: string;
  contacted: boolean;
  replied: boolean;
  booked: boolean;
  arrived: boolean;
  note?: string;
  updatedAt: string;
};

export type MemberReactivationOutcomeLabel =
  | "pending"
  | "contacted-no-reply"
  | "replied"
  | "booked"
  | "arrived"
  | "closed-lost";

export type MemberReactivationOutcomeSnapshotRecord = {
  orgId: string;
  bizDate: string;
  memberId: string;
  customerIdentityKey: string;
  customerDisplayName: string;
  primarySegment: CustomerPrimarySegment;
  followupBucket: MemberReactivationFollowupBucket;
  priorityBand: MemberReactivationPriorityBand;
  recommendedActionLabel: MemberReactivationActionLabel;
  feedbackStatus: MemberReactivationFeedbackStatus;
  contacted: boolean;
  replied: boolean;
  booked: boolean;
  arrived: boolean;
  closed: boolean;
  outcomeLabel: MemberReactivationOutcomeLabel;
  outcomeScore: number;
  learningJson: string;
  updatedAt: string;
};

export type MemberReactivationExecutionTaskRecord = MemberReactivationQueueRecord & {
  feedbackStatus: MemberReactivationFeedbackStatus;
  followedBy?: string;
  followedAt?: string;
  contacted: boolean;
  replied: boolean;
  booked: boolean;
  arrived: boolean;
  note?: string;
  feedbackUpdatedAt?: string;
  aiAdvisory?: {
    followupSummary?: {
      outcomeSummary?: string;
      objectionLabels?: string[];
      nextBestAction?: string;
      followupDraft?: string;
    };
  };
};

export type MemberReactivationExecutionPriorityBandCount = {
  priorityBand: MemberReactivationPriorityBand;
  count: number;
};

export type MemberReactivationExecutionFollowupBucketCount = {
  followupBucket: MemberReactivationFollowupBucket;
  count: number;
};

export type MemberReactivationExecutionSummary = {
  orgId: string;
  bizDate: string;
  totalTaskCount: number;
  pendingCount: number;
  contactedCount: number;
  repliedCount: number;
  bookedCount: number;
  arrivedCount: number;
  closedCount: number;
  contactRate: number | null;
  bookingRate: number | null;
  arrivalRate: number | null;
  priorityBandCounts: MemberReactivationExecutionPriorityBandCount[];
  followupBucketCounts: MemberReactivationExecutionFollowupBucketCount[];
  topPendingTasks: MemberReactivationExecutionTaskRecord[];
};

export type DailyGroupbuyPlatformMetric = {
  platform: string;
  orderCount: number;
  orderShare: number | null;
  amount: number;
  amountShare: number | null;
};

export type DailyStoreMetrics = {
  orgId: string;
  storeName: string;
  bizDate: string;
  serviceRevenue: number;
  rechargeCash: number;
  rechargeStoredValue: number;
  rechargeBonusValue: number;
  antiServiceRevenue: number;
  serviceOrderCount: number;
  customerCount: number;
  averageTicket: number;
  totalClockCount: number;
  upClockRecordCount: number;
  pointClockRecordCount: number;
  pointClockRate: number | null;
  addClockRecordCount: number;
  addClockRate: number | null;
  clockRevenue: number;
  clockEffect: number;
  activeTechCount: number;
  onDutyTechCount: number;
  techCommission: number;
  techCommissionRate: number;
  marketRevenue: number;
  marketCommission: number;
  memberPaymentAmount: number;
  memberPaymentShare: number | null;
  cashPaymentAmount: number;
  cashPaymentShare: number | null;
  wechatPaymentAmount: number;
  wechatPaymentShare: number | null;
  alipayPaymentAmount: number;
  alipayPaymentShare: number | null;
  storedConsumeAmount: number;
  storedConsumeRate: number | null;
  groupbuyOrderCount: number;
  groupbuyOrderShare: number | null;
  groupbuyAmount: number;
  groupbuyAmountShare: number | null;
  groupbuyPlatformBreakdown: DailyGroupbuyPlatformMetric[];
  groupbuyCohortCustomerCount: number;
  groupbuyRevisitCustomerCount: number;
  groupbuyRevisitRate: number | null;
  groupbuyMemberPayConvertedCustomerCount: number;
  groupbuyMemberPayConversionRate: number | null;
  groupbuy7dRevisitCustomerCount: number;
  groupbuy7dRevisitRate: number | null;
  groupbuy7dCardOpenedCustomerCount: number;
  groupbuy7dCardOpenedRate: number | null;
  groupbuy7dStoredValueConvertedCustomerCount: number;
  groupbuy7dStoredValueConversionRate: number | null;
  groupbuy30dMemberPayConvertedCustomerCount: number;
  groupbuy30dMemberPayConversionRate: number | null;
  groupbuyFirstOrderCustomerCount: number;
  groupbuyFirstOrderHighValueMemberCustomerCount: number;
  groupbuyFirstOrderHighValueMemberRate: number | null;
  effectiveMembers: number;
  newMembers: number;
  sleepingMembers: number;
  sleepingMemberRate: number | null;
  currentStoredBalance: number;
  highBalanceSleepingMemberCount?: number;
  highBalanceSleepingMemberAmount?: number;
  firstChargeUnconsumedMemberCount?: number;
  firstChargeUnconsumedMemberAmount?: number;
  storedBalanceLifeMonths?: number | null;
  renewalPressureIndex30d?: number | null;
  memberRepurchaseBaseCustomerCount7d?: number;
  memberRepurchaseReturnedCustomerCount7d?: number;
  memberRepurchaseRate7d?: number | null;
  roomOccupancyRate: number | null;
  roomTurnoverRate: number | null;
  grossMarginRate: number | null;
  netMarginRate: number | null;
  breakEvenRevenue: number | null;
  incompleteSync: boolean;
  staleSyncEndpoints?: string[];
  unavailableMetrics: string[];
};

export type DailyStoreAlert = {
  code: string;
  severity: "info" | "warn" | "critical";
  message: string;
};

export type DailyStoreReport = {
  orgId: string;
  storeName: string;
  bizDate: string;
  metrics: DailyStoreMetrics;
  alerts: DailyStoreAlert[];
  suggestions: string[];
  markdown: string;
  complete: boolean;
};

export type FiveStoreDailyOverviewCoreMetrics = {
  serviceRevenue: number;
  customerCount: number;
  serviceOrderCount: number;
  averageTicket: number | null;
  totalClockCount: number;
  pointClockRate: number | null;
  addClockRate: number | null;
  clockEffect: number;
  rechargeCash: number;
  storedConsumeAmount: number;
  memberPaymentAmount: number;
  effectiveMembers?: number;
  newMembers?: number;
  sleepingMembers?: number;
  sleepingMemberRate?: number | null;
  highBalanceSleepingMemberCount?: number;
  highBalanceSleepingMemberAmount?: number;
  firstChargeUnconsumedMemberCount?: number;
  firstChargeUnconsumedMemberAmount?: number;
  memberRepurchaseBaseCustomerCount7d?: number;
  memberRepurchaseReturnedCustomerCount7d?: number;
  memberRepurchaseRate7d?: number | null;
};

export type FiveStoreDailyOverviewStoreSnapshot = {
  orgId: string;
  storeName: string;
  current: FiveStoreDailyOverviewCoreMetrics;
  previousWeekSameDay?: FiveStoreDailyOverviewCoreMetrics | null;
};

export type FiveStoreDailyOverviewInput = {
  bizDate: string;
  baselineBizDate?: string;
  backgroundHint?: string;
  stores: FiveStoreDailyOverviewStoreSnapshot[];
};

export type HetangClientLike = {
  fetchPaged: (
    endpoint: "1.1" | "1.2" | "1.3",
    params: Record<string, unknown>,
  ) => Promise<unknown[]>;
  fetchUserTrades: (params: Record<string, unknown>) => Promise<unknown[]>;
  fetchTechList: (params: Record<string, unknown>) => Promise<unknown[]>;
  fetchTechUpClockList: (params: Record<string, unknown>) => Promise<unknown[]>;
  fetchTechMarketList: (params: Record<string, unknown>) => Promise<unknown[]>;
  fetchTechCommissionSetList: (params: Record<string, unknown>) => Promise<unknown[]>;
};

export type HetangLogger = {
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
  debug?: (message: string, ...args: unknown[]) => void;
};
