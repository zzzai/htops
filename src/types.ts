export type HetangNotificationTarget = {
  channel: string;
  target: string;
  accountId?: string;
  threadId?: string;
  enabled: boolean;
};

export type HetangStoreConfig = {
  orgId: string;
  storeName: string;
  rawAliases: string[];
  isActive: boolean;
  notification?: HetangNotificationTarget;
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
  middayBriefAtLocalTime: string;
  reactivationPushAtLocalTime: string;
  sharedDelivery?: HetangNotificationTarget;
  sendReportEnabled: boolean;
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

export type HetangServicePollerHealth = {
  poller: "scheduled" | "analysis";
  status?: "ok" | "failed";
  lastRunAt?: string;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastDurationMs?: number;
  lastResultCount?: number;
  lastError?: string;
  lastLines?: string[];
};

export type HetangSchedulerJobStatus = "disabled" | "waiting" | "pending" | "completed";

export type HetangSchedulerJobSummary = {
  jobType: ScheduledJobType;
  label: string;
  orchestrator: "sync" | "delivery";
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
  pollers: HetangServicePollerHealth[];
  jobs: HetangSchedulerJobSummary[];
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
};

export type HetangQueueLaneSummary = {
  pendingCount: number;
  completedCount: number;
  waitingCount: number;
};

export type HetangQueueStatusSummary = {
  sync: HetangQueueLaneSummary;
  delivery: HetangQueueLaneSummary;
  analysis: HetangAnalysisQueueSummary;
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
  semanticFallback: HetangSemanticFallbackConfig;
  conversationQuality: HetangConversationQualityConfig;
  service: HetangServiceConfig;
  queue: HetangQueueConfig;
  database: HetangDatabaseConfig;
  stores: HetangStoreConfig[];
  externalIntelligence: HetangExternalIntelligenceConfig;
};

export type HetangExternalSourceTier = "s" | "a" | "b" | "blocked";

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

export type EndpointCode = "1.1" | "1.2" | "1.3" | "1.4" | "1.5" | "1.6" | "1.7" | "1.8";

export type SyncWindow = {
  start: Date;
  end: Date;
  startTime: string;
  endTime: string;
};

export type ScheduledJobType =
  | "sync"
  | "run-customer-history-catchup"
  | "build-report"
  | "send-report"
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
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
  debug?: (message: string) => void;
};
