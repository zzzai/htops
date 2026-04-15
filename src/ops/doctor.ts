import type {
  HetangAnalysisDeliveryHealthSummary,
  HetangQueueStatusSummary,
  HetangSchedulerJobSummary,
  HetangServicePollerHealth,
} from "../types.js";

export function formatDoctorPollerState(
  poller: "scheduled" | "analysis",
  state: Partial<HetangServicePollerHealth> | null,
): string {
  if (!state?.status || !state.lastRunAt) {
    return `Poller ${poller}: no runs recorded`;
  }
  const details = [`Poller ${poller}: ${state.status}`, `lastRun=${state.lastRunAt}`];
  if (typeof state.lastResultCount === "number") {
    details.push(`results=${state.lastResultCount}`);
  }
  if (state.lastError) {
    details.push(`error=${state.lastError}`);
  }
  return details.join(" | ");
}

export function formatAnalysisDeliveryHealthSummary(
  summary: HetangAnalysisDeliveryHealthSummary,
): string {
  return [
    "Analysis delivery:",
    `jobs pending ${summary.jobPendingCount} / retrying ${summary.jobRetryingCount} / abandoned ${summary.jobAbandonedCount};`,
    `subscribers pending ${summary.subscriberPendingCount} / retrying ${summary.subscriberRetryingCount} / abandoned ${summary.subscriberAbandonedCount}`,
  ].join(" ");
}

export function formatSchedulerJobDoctorLine(job: HetangSchedulerJobSummary): string {
  const details = [
    `${job.label}(${job.jobType})`,
    `status=${job.status}`,
    `runKey=${job.runKey}`,
    `schedule=${job.schedule}`,
  ];
  if (job.lastRanAt) {
    details.push(`lastRan=${job.lastRanAt}`);
  }
  return `Scheduler job: ${details.join(" | ")}`;
}

export function formatQueueLaneLine(
  label: string,
  summary: HetangQueueStatusSummary["sync"],
): string {
  return `${label}: pending ${summary.pendingCount} / waiting ${summary.waitingCount} / completed ${summary.completedCount}`;
}

export function formatAnalysisQueueLine(summary: HetangQueueStatusSummary["analysis"]): string {
  return [
    "Analysis queue:",
    `pending ${summary.pendingCount}`,
    `running ${summary.runningCount}`,
    `failed ${summary.failedCount}`,
    `job-delivery ${summary.jobDeliveryPendingCount}/${summary.jobDeliveryRetryingCount}/${summary.jobDeliveryAbandonedCount}`,
    `subscriber-delivery ${summary.subscriberDeliveryPendingCount}/${summary.subscriberDeliveryRetryingCount}/${summary.subscriberDeliveryAbandonedCount}`,
    `dead-letters ${summary.unresolvedDeadLetterCount}`,
  ].join(" | ");
}

export async function renderHetangDoctorReport(params: {
  dbUrl: string;
  poolRole: string;
  poolMax: number;
  timeZone: string;
  storeCount: number;
  apiCredentialsConfigured: boolean;
  middayBriefTime: string;
  schedulerLines: string[];
  queueLines: string[];
  storeWatermarks: Array<{ orgId: string; storeName: string; summary: string }>;
}): Promise<string> {
  return [
    `DB: ${params.dbUrl}`,
    `DB pool role: ${params.poolRole}`,
    `DB pool max: ${params.poolMax}`,
    `Timezone: ${params.timeZone}`,
    `Stores: ${params.storeCount}`,
    `API sync credentials: ${params.apiCredentialsConfigured ? "configured" : "missing"}`,
    `Midday brief time: ${params.middayBriefTime}`,
    "Scheduler: app service pollers authoritative",
    ...params.schedulerLines,
    ...params.queueLines,
    ...params.storeWatermarks.map(
      (item) => `${item.storeName} (${item.orgId}) -> ${item.summary}`,
    ),
  ].join("\n");
}
