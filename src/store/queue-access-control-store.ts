import type {
  HetangActionItem,
  HetangAnalysisDeadLetterCleanupResult,
  HetangConversationReviewFinding,
  HetangConversationReviewRun,
  HetangAnalysisDeadLetterSummary,
  HetangAnalysisDeadLetter,
  HetangAnalysisJob,
  HetangAnalysisQueueSummary,
  HetangAnalysisSubscriber,
  HetangCommandAuditRecord,
  HetangControlTowerSettingRecord,
  HetangEmployeeBinding,
  HetangInboundMessageAuditRecord,
  HetangServicePollerHealth,
  ScheduledJobType,
} from "../types.js";

type QueueAccessControlLegacyStore = {
  listCompletedRunKeys: () => Promise<Set<string>>;
  getLatestScheduledJobRunTimes: () => Promise<Partial<Record<ScheduledJobType, string>>>;
  markScheduledJobCompleted: (jobType: string, runKey: string, ranAt: string) => Promise<void>;
  getScheduledJobState: (
    jobType: string,
    stateKey: string,
  ) => Promise<Record<string, unknown> | null>;
  deleteScheduledJobState: (jobType: string, stateKey: string) => Promise<void>;
  setScheduledJobState: (
    jobType: string,
    stateKey: string,
    state: Record<string, unknown>,
    updatedAt: string,
  ) => Promise<void>;
  upsertEmployeeBinding: (binding: HetangEmployeeBinding) => Promise<void>;
  getEmployeeBinding: (params: {
    channel: string;
    senderId: string;
  }) => Promise<HetangEmployeeBinding | null>;
  listEmployeeBindings: (channel?: string) => Promise<HetangEmployeeBinding[]>;
  revokeEmployeeBinding: (params: {
    channel: string;
    senderId: string;
    updatedAt?: string;
  }) => Promise<void>;
  recordCommandAudit: (record: HetangCommandAuditRecord) => Promise<void>;
  countAllowedCommandAudits: (params: {
    channel: string;
    senderId: string;
    since: string;
  }) => Promise<number>;
  recordInboundMessageAudit: (record: HetangInboundMessageAuditRecord) => Promise<void>;
  listInboundMessageAudits: (params?: {
    channel?: string;
    senderId?: string;
    conversationId?: string;
    contains?: string;
    limit?: number;
  }) => Promise<HetangInboundMessageAuditRecord[]>;
  createConversationReviewRun: (run: HetangConversationReviewRun) => Promise<void>;
  createConversationReviewFinding: (finding: HetangConversationReviewFinding) => Promise<void>;
  listConversationReviewRuns: (params?: {
    status?: HetangConversationReviewRun["status"];
    limit?: number;
  }) => Promise<HetangConversationReviewRun[]>;
  listConversationReviewFindings: (params?: {
    reviewRunId?: string;
    findingType?: HetangConversationReviewFinding["findingType"];
    status?: HetangConversationReviewFinding["status"];
    limit?: number;
  }) => Promise<HetangConversationReviewFinding[]>;
  createAnalysisJob: (job: HetangAnalysisJob) => Promise<void>;
  upsertAnalysisSubscriber: (params: {
    jobId: string;
    channel: string;
    target: string;
    accountId?: string;
    threadId?: string;
    senderId?: string;
    createdAt: string;
  }) => Promise<HetangAnalysisSubscriber>;
  countPendingAnalysisJobsByOrg: (orgId: string) => Promise<number>;
  getAnalysisDeliveryHealthSummary: () => Promise<{
    jobPendingCount: number;
    jobRetryingCount: number;
    jobAbandonedCount: number;
    subscriberPendingCount: number;
    subscriberRetryingCount: number;
    subscriberAbandonedCount: number;
  }>;
  getAnalysisDeadLetterSummary: () => Promise<HetangAnalysisDeadLetterSummary | null>;
  getAnalysisQueueSummary: () => Promise<HetangAnalysisQueueSummary>;
  listAnalysisDeadLetters: (params?: {
    orgId?: string;
    deadLetterScope?: HetangAnalysisDeadLetter["deadLetterScope"];
    unresolvedOnly?: boolean;
    limit?: number;
  }) => Promise<HetangAnalysisDeadLetter[]>;
  replayAnalysisDeadLetter: (params: {
    deadLetterKey: string;
    replayedAt: string;
  }) => Promise<HetangAnalysisDeadLetter | null>;
  cleanupStaleInvalidChatidSubscriberResiduals: (params: {
    resolvedAt: string;
    staleBefore: string;
    limit?: number;
  }) => Promise<HetangAnalysisDeadLetterCleanupResult>;
  getNextDeliverableAnalysisSubscription: (asOf?: string) => Promise<
    | (HetangAnalysisJob & {
        subscriberKey: string;
        deliveryChannel: string;
        deliveryTarget: string;
        deliveryAccountId?: string;
        deliveryThreadId?: string;
      })
    | null
  >;
  getAnalysisJob: (jobId: string) => Promise<HetangAnalysisJob | null>;
  listAnalysisJobs: (params?: {
    orgId?: string;
    status?: HetangAnalysisJob["status"];
  }) => Promise<HetangAnalysisJob[]>;
  findReusableAnalysisJob: (params: {
    jobType: HetangAnalysisJob["jobType"];
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) => Promise<HetangAnalysisJob | null>;
  getNextDeliverableAnalysisJob: (asOf?: string) => Promise<HetangAnalysisJob | null>;
  claimNextPendingAnalysisJob: (params: {
    startedAt: string;
    staleBefore?: string;
  }) => Promise<HetangAnalysisJob | null>;
  completeAnalysisJob: (params: {
    jobId: string;
    resultText: string;
    finishedAt: string;
  }) => Promise<void>;
  failAnalysisJob: (params: {
    jobId: string;
    errorMessage: string;
    finishedAt: string;
  }) => Promise<void>;
  retryAnalysisJob: (params: {
    jobId: string;
    retriedAt: string;
  }) => Promise<HetangAnalysisJob | null>;
  markAnalysisSubscriberDelivered: (params: {
    subscriberKey: string;
    deliveredAt: string;
  }) => Promise<void>;
  markAnalysisSubscriberDeliveryAttempt: (params: {
    subscriberKey: string;
    attemptedAt: string;
    errorMessage?: string;
    nextDeliveryAfter?: string | null;
  }) => Promise<void>;
  refreshAnalysisJobDeliveryState: (params: { jobId: string; deliveredAt: string }) => Promise<void>;
  markAnalysisJobDelivered: (params: { jobId: string; deliveredAt: string }) => Promise<void>;
  markAllAnalysisSubscribersDelivered: (params: {
    jobId: string;
    deliveredAt: string;
  }) => Promise<void>;
  markAnalysisJobDeliveryAttempt: (params: {
    jobId: string;
    attemptedAt: string;
    errorMessage?: string;
    nextDeliveryAfter?: string | null;
  }) => Promise<void>;
  markAnalysisJobDeliveryAbandoned: (params: {
    jobId: string;
    abandonedAt: string;
    errorMessage?: string;
  }) => Promise<void>;
  createActionItem: (item: HetangActionItem) => Promise<void>;
  updateActionItemStatus: (params: {
    actionId: string;
    status: HetangActionItem["status"];
    resultNote?: string;
    effectScore?: number;
    ownerName?: string;
    dueDate?: string;
    updatedAt: string;
    completedAt?: string;
  }) => Promise<void>;
  getActionItem: (actionId: string) => Promise<HetangActionItem | null>;
  listActionItems: (params?: {
    orgId?: string;
    status?: HetangActionItem["status"];
  }) => Promise<HetangActionItem[]>;
  upsertControlTowerSetting: (record: HetangControlTowerSettingRecord) => Promise<void>;
  listControlTowerSettings: (params?: {
    scopeType?: string;
    scopeKey?: string;
  }) => Promise<HetangControlTowerSettingRecord[]>;
  resolveControlTowerSettings: (orgId?: string) => Promise<Record<string, string | number | boolean>>;
};

export class HetangQueueAccessControlStore {
  constructor(private readonly legacy: QueueAccessControlLegacyStore) {}

  listCompletedRunKeys() {
    return this.legacy.listCompletedRunKeys();
  }

  getLatestScheduledJobRunTimes() {
    return this.legacy.getLatestScheduledJobRunTimes();
  }

  markScheduledJobCompleted(jobType: string, runKey: string, ranAt: string) {
    return this.legacy.markScheduledJobCompleted(jobType, runKey, ranAt);
  }

  getScheduledJobState(jobType: string, stateKey: string) {
    return this.legacy.getScheduledJobState(jobType, stateKey);
  }

  deleteScheduledJobState(jobType: string, stateKey: string) {
    return this.legacy.deleteScheduledJobState(jobType, stateKey);
  }

  setScheduledJobState(
    jobType: string,
    stateKey: string,
    state: Record<string, unknown>,
    updatedAt: string,
  ) {
    return this.legacy.setScheduledJobState(jobType, stateKey, state, updatedAt);
  }

  upsertEmployeeBinding(binding: HetangEmployeeBinding) {
    return this.legacy.upsertEmployeeBinding(binding);
  }

  getEmployeeBinding(params: { channel: string; senderId: string }) {
    return this.legacy.getEmployeeBinding(params);
  }

  listEmployeeBindings(channel?: string) {
    return this.legacy.listEmployeeBindings(channel);
  }

  revokeEmployeeBinding(params: { channel: string; senderId: string; updatedAt?: string }) {
    return this.legacy.revokeEmployeeBinding(params);
  }

  recordCommandAudit(record: HetangCommandAuditRecord) {
    return this.legacy.recordCommandAudit(record);
  }

  countAllowedCommandAudits(params: { channel: string; senderId: string; since: string }) {
    return this.legacy.countAllowedCommandAudits(params);
  }

  recordInboundMessageAudit(record: HetangInboundMessageAuditRecord) {
    return this.legacy.recordInboundMessageAudit(record);
  }

  listInboundMessageAudits(params?: {
    channel?: string;
    senderId?: string;
    conversationId?: string;
    contains?: string;
    limit?: number;
  }) {
    return this.legacy.listInboundMessageAudits(params);
  }

  createConversationReviewRun(run: HetangConversationReviewRun) {
    return this.legacy.createConversationReviewRun(run);
  }

  createConversationReviewFinding(finding: HetangConversationReviewFinding) {
    return this.legacy.createConversationReviewFinding(finding);
  }

  listConversationReviewRuns(params?: {
    status?: HetangConversationReviewRun["status"];
    limit?: number;
  }) {
    return this.legacy.listConversationReviewRuns(params);
  }

  listConversationReviewFindings(params?: {
    reviewRunId?: string;
    findingType?: HetangConversationReviewFinding["findingType"];
    status?: HetangConversationReviewFinding["status"];
    limit?: number;
  }) {
    return this.legacy.listConversationReviewFindings(params);
  }

  createAnalysisJob(job: HetangAnalysisJob) {
    return this.legacy.createAnalysisJob(job);
  }

  upsertAnalysisSubscriber(params: {
    jobId: string;
    channel: string;
    target: string;
    accountId?: string;
    threadId?: string;
    senderId?: string;
    createdAt: string;
  }) {
    return this.legacy.upsertAnalysisSubscriber(params);
  }

  countPendingAnalysisJobsByOrg(orgId: string) {
    return this.legacy.countPendingAnalysisJobsByOrg(orgId);
  }

  getAnalysisDeliveryHealthSummary() {
    return this.legacy.getAnalysisDeliveryHealthSummary();
  }

  getAnalysisQueueSummary() {
    return this.legacy.getAnalysisQueueSummary();
  }

  getAnalysisDeadLetterSummary() {
    return this.legacy.getAnalysisDeadLetterSummary();
  }

  listAnalysisDeadLetters(params?: {
    orgId?: string;
    deadLetterScope?: HetangAnalysisDeadLetter["deadLetterScope"];
    unresolvedOnly?: boolean;
    limit?: number;
  }) {
    return this.legacy.listAnalysisDeadLetters(params);
  }

  replayAnalysisDeadLetter(params: { deadLetterKey: string; replayedAt: string }) {
    return this.legacy.replayAnalysisDeadLetter(params);
  }

  cleanupStaleInvalidChatidSubscriberResiduals(params: {
    resolvedAt: string;
    staleBefore: string;
    limit?: number;
  }) {
    return this.legacy.cleanupStaleInvalidChatidSubscriberResiduals(params);
  }

  getNextDeliverableAnalysisSubscription(asOf?: string) {
    return this.legacy.getNextDeliverableAnalysisSubscription(asOf);
  }

  getAnalysisJob(jobId: string) {
    return this.legacy.getAnalysisJob(jobId);
  }

  listAnalysisJobs(params?: { orgId?: string; status?: HetangAnalysisJob["status"] }) {
    return this.legacy.listAnalysisJobs(params);
  }

  findReusableAnalysisJob(params: {
    jobType: HetangAnalysisJob["jobType"];
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) {
    return this.legacy.findReusableAnalysisJob(params);
  }

  getNextDeliverableAnalysisJob(asOf?: string) {
    return this.legacy.getNextDeliverableAnalysisJob(asOf);
  }

  claimNextPendingAnalysisJob(params: { startedAt: string; staleBefore?: string }) {
    return this.legacy.claimNextPendingAnalysisJob(params);
  }

  completeAnalysisJob(params: { jobId: string; resultText: string; finishedAt: string }) {
    return this.legacy.completeAnalysisJob(params);
  }

  failAnalysisJob(params: { jobId: string; errorMessage: string; finishedAt: string }) {
    return this.legacy.failAnalysisJob(params);
  }

  retryAnalysisJob(params: { jobId: string; retriedAt: string }) {
    return this.legacy.retryAnalysisJob(params);
  }

  markAnalysisSubscriberDelivered(params: { subscriberKey: string; deliveredAt: string }) {
    return this.legacy.markAnalysisSubscriberDelivered(params);
  }

  markAnalysisSubscriberDeliveryAttempt(params: {
    subscriberKey: string;
    attemptedAt: string;
    errorMessage?: string;
    nextDeliveryAfter?: string | null;
  }) {
    return this.legacy.markAnalysisSubscriberDeliveryAttempt(params);
  }

  refreshAnalysisJobDeliveryState(params: { jobId: string; deliveredAt: string }) {
    return this.legacy.refreshAnalysisJobDeliveryState(params);
  }

  markAnalysisJobDelivered(params: { jobId: string; deliveredAt: string }) {
    return this.legacy.markAnalysisJobDelivered(params);
  }

  markAllAnalysisSubscribersDelivered(params: { jobId: string; deliveredAt: string }) {
    return this.legacy.markAllAnalysisSubscribersDelivered(params);
  }

  markAnalysisJobDeliveryAttempt(params: {
    jobId: string;
    attemptedAt: string;
    errorMessage?: string;
    nextDeliveryAfter?: string | null;
  }) {
    return this.legacy.markAnalysisJobDeliveryAttempt(params);
  }

  markAnalysisJobDeliveryAbandoned(params: {
    jobId: string;
    abandonedAt: string;
    errorMessage?: string;
  }) {
    return this.legacy.markAnalysisJobDeliveryAbandoned(params);
  }

  createActionItem(item: HetangActionItem) {
    return this.legacy.createActionItem(item);
  }

  updateActionItemStatus(params: {
    actionId: string;
    status: HetangActionItem["status"];
    resultNote?: string;
    effectScore?: number;
    ownerName?: string;
    dueDate?: string;
    updatedAt: string;
    completedAt?: string;
  }) {
    return this.legacy.updateActionItemStatus(params);
  }

  getActionItem(actionId: string) {
    return this.legacy.getActionItem(actionId);
  }

  listActionItems(params?: { orgId?: string; status?: HetangActionItem["status"] }) {
    return this.legacy.listActionItems(params);
  }

  upsertControlTowerSetting(record: HetangControlTowerSettingRecord) {
    return this.legacy.upsertControlTowerSetting(record);
  }

  listControlTowerSettings(params?: { scopeType?: string; scopeKey?: string }) {
    return this.legacy.listControlTowerSettings(params);
  }

  resolveControlTowerSettings(orgId?: string) {
    return this.legacy.resolveControlTowerSettings(orgId);
  }
}
