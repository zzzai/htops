import type {
  HetangAiLaneObservabilitySummary,
  HetangAnalysisDeliveryHealthSummary,
  HetangDailyReportAuditSummary,
  HetangDailyReportReadinessSummary,
  HetangEnvironmentMemoryDisturbanceSummary,
  HetangEnvironmentMemoryReadinessSummary,
  HetangIndustryContextReadinessSummary,
  HetangFiveStoreDailyOverviewSummary,
  HetangAnalysisDeadLetterSummary,
  HetangRecentCommandAuditSummary,
  HetangQueueStatusSummary,
  HetangReportDeliveryUpgradeSummary,
  HetangSchedulerJobSummary,
  HetangSemanticQualitySummary,
  HetangServicePollerHealth,
  HetangSyncExecutionSummary,
} from "../types.js";
import type { RouteCompareSummary } from "../route-compare-summary.js";

export type HermesCommandBridgeHealthSummary = {
  handledCount: number;
  fallbackCount: number;
  latestCommand: string | null;
  latestResult: string | null;
  latestAt: string | null;
};

export type HermesWecomTransportHealthSummary = {
  websocketErrorCount: number;
  reconnectFailureCount: number;
  reconnectSuccessCount: number;
  latestWsState: string | null;
  latestAt: string | null;
};

export type HermesGatewayLogHealthSummary = {
  commandBridge: HermesCommandBridgeHealthSummary | null;
  wecomTransport: HermesWecomTransportHealthSummary | null;
};

function formatPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) {
    return "n/a";
  }
  return `${Number.isInteger(value) ? value : value.toFixed(1).replace(/\.0$/u, "")}%`;
}

function formatLatency(value: number | null): string {
  if (value == null || !Number.isFinite(value)) {
    return "n/a";
  }
  return `${Math.round(value)}ms`;
}

function formatTopCounts(entries: Array<{ key: string; count: number }>, limit = 3): string {
  if (entries.length === 0) {
    return "none";
  }
  return entries
    .slice(0, limit)
    .map((entry) => `${entry.key}:${entry.count}`)
    .join(",");
}

function summarizeSemanticBacklog(summary: HetangSemanticQualitySummary): string | null {
  if ((summary.optimizationBacklog?.length ?? 0) <= 0) {
    return null;
  }
  return summary.optimizationBacklog
    .slice(0, 2)
    .map((entry) => `${entry.failureClass}@${entry.ownerModule}(${entry.priority})`)
    .join(",");
}

function summarizeSemanticSamples(summary: HetangSemanticQualitySummary): string | null {
  if ((summary.sampleCandidates?.length ?? 0) <= 0) {
    return null;
  }
  return summary.sampleCandidates
    .slice(0, 2)
    .map((entry) => entry.prompt.trim())
    .filter((entry) => entry.length > 0)
    .join(" ; ");
}

function summarizeCarryRiskCounts(summary: HetangSemanticQualitySummary): string | null {
  const carryFailures = summary.topFailureClasses.filter((entry) =>
    entry.failureClass === "scope_inheritance_miss" ||
    entry.failureClass === "topic_switch_false_positive",
  );
  if (carryFailures.length <= 0) {
    return null;
  }
  return carryFailures.map((entry) => `${entry.failureClass}:${entry.count}`).join(",");
}

function summarizeReviewBacklog(summary: HetangSemanticQualitySummary): string | null {
  const reviewBacklog = summary.reviewBacklog;
  if (!reviewBacklog || reviewBacklog.length <= 0) {
    return null;
  }
  return reviewBacklog
    .slice(0, 2)
    .map((entry) => `${entry.failureClass}@${entry.ownerModule}(${entry.priority})`)
    .join(",");
}

function summarizeReviewSamples(summary: HetangSemanticQualitySummary): string | null {
  const reviewSampleCandidates = summary.reviewSampleCandidates;
  if (!reviewSampleCandidates || reviewSampleCandidates.length <= 0) {
    return null;
  }
  return reviewSampleCandidates
    .slice(0, 2)
    .map((entry) => entry.prompt.trim())
    .filter((entry) => entry.length > 0)
    .join(" ; ");
}

function extractLogTimestamp(line: string): string | null {
  const isoMatch = line.match(/^(\d{4}-\d{2}-\d{2}T[^\s]+)/u);
  if (isoMatch?.[1]) {
    return isoMatch[1];
  }
  const spacedMatch = line.match(/^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:,\d+)?)/u);
  if (spacedMatch?.[1]) {
    return spacedMatch[1];
  }
  return null;
}

export function formatDoctorPollerState(
  poller: "scheduled-sync" | "scheduled-delivery" | "analysis",
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

export function formatDoctorWarningLine(message: string): string {
  return `Scheduler warning: ${message}`;
}

export function formatReportDeliveryUpgradeSummary(
  summary: HetangReportDeliveryUpgradeSummary,
): string {
  if (summary.recentUpgradeCount <= 0 || summary.recentUpgrades.length === 0) {
    return "Report delivery upgrades (7d): none";
  }
  const latest = summary.recentUpgrades[0];
  return [
    `Report delivery upgrades (7d): ${summary.recentUpgradeCount}`,
    `latest=${latest.storeName} ${latest.bizDate} at ${latest.upgradedAt}`,
  ].join(" | ");
}

export function formatDailyReportAuditSummary(
  summary: HetangDailyReportAuditSummary | null | undefined,
): string {
  if (!summary) {
    return "Daily report audit (7d): no runs recorded";
  }
  const details = [
    `Daily report audit (${summary.windowDays}d): ${summary.status}`,
    `end=${summary.endBizDate}`,
    `checked=${summary.checkedReports}`,
    `fresh_diff=${summary.reportsWithFreshMismatch}`,
  ];
  if (summary.status === "healthy") {
    details.push(`stored_diff=${summary.reportsWithStoredMismatch}`);
  } else {
    details.push(`stored_diff_reports=${summary.reportsWithStoredMismatch}`);
  }
  details.push(`missing=${summary.reportsWithOnlyMissingStored}`);
  details.push(`unaudited=${summary.maxUnauditedMetricCount}`);
  const sample = summary.sampleIssues[0];
  const topDiff = sample?.topDiffs[0];
  if (sample && topDiff) {
    details.push(`sample=${sample.storeName}@${sample.bizDate}:${topDiff.metricKey}`);
  }
  return details.join(" | ");
}


export function formatDailyReportReadinessSummary(
  summary: HetangDailyReportReadinessSummary,
): string {
  const details = [
    `Daily report readiness: ${summary.readyCount}/${summary.totalStoreCount} ready`,
    `bizDate=${summary.bizDate}`,
  ];
  if (summary.refreshNeededCount > 0) {
    details.push(`refresh_needed ${summary.refreshNeededCount}`);
  }
  if (summary.incompleteCount > 0) {
    details.push(`incomplete ${summary.incompleteCount}`);
  }
  if (summary.missingCount > 0) {
    details.push(`missing ${summary.missingCount}`);
  }
  const pending = summary.stores
    .filter((entry) => entry.status !== "ready")
    .slice(0, 3)
    .map((entry) => `${entry.storeName}:${entry.status}`)
    .join(",");
  if (pending) {
    details.push(`pending=${pending}`);
  }
  return details.join(" | ");
}

export function formatEnvironmentMemoryReadinessSummary(
  summary: HetangEnvironmentMemoryReadinessSummary,
): string {
  const details = [
    `Environment memory: ${summary.readyCount}/${summary.totalStoreCount} ready`,
    `bizDate=${summary.bizDate}`,
  ];
  if (summary.missingHolidayCount > 0) {
    details.push(`missing_holiday ${summary.missingHolidayCount}`);
  }
  if (summary.missingWeatherCount > 0) {
    details.push(`missing_weather ${summary.missingWeatherCount}`);
  }
  if (summary.fallbackOnlyCount > 0) {
    details.push(`fallback_only ${summary.fallbackOnlyCount}`);
  }
  if (summary.missingCount > 0) {
    details.push(`missing ${summary.missingCount}`);
  }
  if (summary.highDisturbanceCount > 0) {
    details.push(`high_disturbance ${summary.highDisturbanceCount}`);
  }
  const pending = summary.stores
    .filter((entry) => entry.status !== "ready")
    .slice(0, 3)
    .map((entry) => `${entry.storeName}:${entry.status}`)
    .join(",");
  if (pending) {
    details.push(`pending=${pending}`);
  }
  return details.join(" | ");
}

export function formatIndustryContextReadinessSummary(
  summary: HetangIndustryContextReadinessSummary,
): string {
  const details = [
    `Industry context: status=${summary.status}`,
    `bizDate=${summary.bizDate}`,
  ];
  if (summary.snapshotDate) {
    details.push(`snapshot=${summary.snapshotDate}`);
  }
  if (typeof summary.freshnessDays === "number") {
    details.push(`freshness_days=${summary.freshnessDays}`);
  }
  details.push(`items=${summary.itemCount}`);
  const activeCoverage = summary.moduleCoverage.filter((entry) => entry.itemCount > 0);
  details.push(
    `modules=${activeCoverage.length > 0 ? activeCoverage.map((entry) => `${entry.module}:${entry.itemCount}`).join(",") : "none"}`,
  );
  return details.join(" | ");
}

export function formatEnvironmentMemoryDisturbanceSummary(
  summary: HetangEnvironmentMemoryDisturbanceSummary,
): string {
  const details = [
    `Environment memory recent disturbance (${summary.windowDays}d): medium/high ${summary.mediumOrHigherCount}`,
    `high ${summary.highDisturbanceCount}`,
    `hint ${summary.hintCount}`,
    `mention ${summary.mentionCount}`,
  ];
  const latest = summary.highlights[0];
  if (latest) {
    details.push(
      `latest=${latest.storeName} ${latest.bizDate} ${latest.disturbanceLevel} ${latest.reasons.join(",")}`,
    );
  }
  return details.join(" | ");
}

export function formatFiveStoreDailyOverviewSummary(
  summary: HetangFiveStoreDailyOverviewSummary,
): string {
  const details = [
    `5店昨日经营总览: status=${summary.status}`,
    `bizDate=${summary.bizDate}`,
    `daily_reports=${summary.readyCount}/${summary.totalStoreCount} ready`,
  ];
  if (summary.pendingStoreNames.length > 0) {
    details.push(`pending=${summary.pendingStoreNames.slice(0, 3).join(",")}`);
  }
  if (summary.previewSentAt) {
    details.push(`preview=${summary.previewSentAt}`);
  }
  if (summary.canceledBy) {
    details.push(`canceled_by=${summary.canceledBy}`);
  }
  if (summary.confirmedBy) {
    details.push(`confirmed_by=${summary.confirmedBy}`);
  }
  if (summary.canceledAt) {
    details.push(`canceled=${summary.canceledAt}`);
  }
  if (summary.finalSentAt) {
    details.push(`sent=${summary.finalSentAt}`);
  }
  if (summary.finalTarget) {
    details.push(`target=${summary.finalTarget.channel}:${summary.finalTarget.target}`);
  }
  return details.join(" | ");
}

export function formatAiLaneObservabilityLines(
  summaries: HetangAiLaneObservabilitySummary[],
): string[] {
  return summaries.map((summary) => {
    const details = [
      `AI lane ${summary.observabilityLabel}: model=${summary.model}`,
      `reasoning=${summary.reasoningMode}`,
      `timeout=${summary.timeoutMs}ms`,
      `response=${summary.responseMode}`,
      `mode=${summary.executionMode}`,
      `task=${summary.taskClass}`,
      `fallback=${summary.fallbackBehavior}`,
    ];
    if (summary.fallbackLaneId) {
      details.push(`fallback_lane=${summary.fallbackLaneId}`);
    }
    if (summary.overrideKeys.length > 0) {
      details.push(`overrides=${summary.overrideKeys.join(",")}`);
    }
    return details.join(" | ");
  });
}

export function formatSchedulerJobDoctorLine(job: HetangSchedulerJobSummary): string {
  const details = [
    `${job.label}(${job.jobType})`,
    `status=${job.status}`,
    `runKey=${job.runKey}`,
    `schedule=${job.schedule}`,
  ];
  if (job.surfaceRole !== "primary") {
    details.push(`role=${job.surfaceRole}`);
  }
  if (job.surfaceNote) {
    details.push(`note=${job.surfaceNote}`);
  }
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

export function formatSyncExecutionLine(summary: HetangSyncExecutionSummary): string {
  const details = [
    `Sync execution: running ${summary.runningCount}`,
    `stale ${summary.staleRunningCount}`,
    `daily ${summary.dailyRunningCount}/${summary.staleDailyRunningCount}`,
    `backfill ${summary.backfillRunningCount}/${summary.staleBackfillRunningCount}`,
  ];
  if (summary.latestStartedAt) {
    details.push(`latest=${summary.latestStartedAt}`);
  }
  if (typeof summary.latestAgeHours === "number") {
    details.push(`age=${summary.latestAgeHours.toFixed(1)}h`);
  }
  if (summary.staleCutoffAt) {
    details.push(`staleBefore=${summary.staleCutoffAt}`);
  }
  return details.join(" | ");
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

export function formatAnalysisDeadLetterSummary(
  summary: HetangAnalysisDeadLetterSummary,
  unresolvedDeadLetterCount: number,
): string {
  const details = [
    `Analysis dead letters: unresolved ${unresolvedDeadLetterCount} (job ${summary.unresolvedJobCount} / subscriber ${summary.unresolvedSubscriberCount})`,
  ];
  if (summary.latestUnresolvedAt) {
    details.push(`latest=${summary.latestUnresolvedAt}`);
  }
  if (typeof summary.latestUnresolvedAgeHours === "number") {
    details.push(`age=${summary.latestUnresolvedAgeHours.toFixed(1)}h`);
  }
  if (typeof summary.stale === "boolean") {
    details.push(`stale=${summary.stale ? "yes" : "no"}`);
  }
  if (summary.latestReason) {
    details.push(`reason=${summary.latestReason}`);
  }
  if (summary.residualClass) {
    details.push(`residual=${summary.residualClass}`);
  }
  return details.join(" | ");
}

export function formatHermesCommandAuditLine(
  summary: HetangRecentCommandAuditSummary,
): string {
  const details = [
    `Hermes command bridge: recent allowed audits ${summary.recentAllowedCount} (${summary.windowHours}h)`,
  ];
  if (summary.latestOccurredAt) {
    details.push(`latest=${summary.latestOccurredAt}`);
  }
  if (summary.latestCommandBody) {
    details.push(`body=${summary.latestCommandBody}`);
  }
  if (summary.latestAction) {
    details.push(`action=${summary.latestAction}`);
  }
  if (summary.latestSenderId) {
    details.push(`sender=${summary.latestSenderId}`);
  }
  if ((summary.recentQueryCount ?? 0) > 0) {
    details.push(
      `query=${summary.recentQueryCount ?? 0} rule=${summary.recentQueryRuleCount ?? 0} clarify=${summary.recentQueryClarifyCount ?? 0} ai=${summary.recentQueryAiFallbackCount ?? 0} unresolved=${summary.recentQueryUnresolvedCount ?? 0}`,
    );
  }
  if (summary.latestQueryEntrySource && summary.latestQueryEntryReason) {
    const prefix = summary.latestQueryOccurredAt ? `${summary.latestQueryOccurredAt} ` : "";
    details.push(
      `latest_query=${prefix}${summary.latestQueryEntrySource}/${summary.latestQueryEntryReason}`,
    );
  }
  return details.join(" | ");
}

export function formatQueryRouteCompareLine(summary: RouteCompareSummary): string {
  if (summary.total <= 0) {
    return "Query route compare: no samples";
  }
  return [
    `Query route compare: samples=${summary.total}`,
    `route_acc=${formatPercent(summary.routeAccuracyPercent)}`,
    `capability_acc=${formatPercent(summary.capabilityAccuracyPercent)}`,
    `clarify=${summary.clarificationNeededCount}`,
    `p50=${formatLatency(summary.latencyP50Ms)}`,
    `p95=${formatLatency(summary.latencyP95Ms)}`,
    `lanes=${formatTopCounts(summary.selectedLanes)}`,
    `top_capability=${formatTopCounts(summary.selectedCapabilities, 1)}`,
  ].join(" | ");
}

export function formatQueryRouteCompareSlowLine(summary: RouteCompareSummary): string | null {
  const sample = summary.slowSamples[0];
  if (!sample) {
    return null;
  }
  const details = [
    `Query slow sample: lane=${sample.selectedLane ?? "null"}`,
    `capability=${sample.selectedCapabilityId ?? "null"}`,
    `latency=${formatLatency(sample.latencyMs ?? null)}`,
  ];
  const text = sample.rawText?.trim() || sample.effectiveText?.trim();
  if (text) {
    details.push(`text=${text.length <= 80 ? text : `${text.slice(0, 77)}...`}`);
  }
  return details.join(" | ");
}

export function formatSemanticQualityLine(summary: HetangSemanticQualitySummary): string {
  const details = [
    `Semantic quality (${summary.windowHours}h): total=${summary.totalCount}`,
    `success=${formatPercent(
      summary.successRate == null ? null : Math.round(summary.successRate * 1000) / 10,
    )}`,
    `clarify=${formatPercent(
      summary.clarifyRate == null ? null : Math.round(summary.clarifyRate * 1000) / 10,
    )}`,
    `fallback=${formatPercent(
      summary.fallbackRate == null ? null : Math.round(summary.fallbackRate * 1000) / 10,
    )}`,
    `fallback_config=${summary.fallbackConfig?.state ?? "unknown"}`,
    `top_failures=${
      summary.topFailureClasses.length > 0
        ? summary.topFailureClasses
            .map((entry) => `${entry.failureClass}:${entry.count}`)
            .join(",")
        : "none"
    }`,
  ];
  if (summary.carrySuccessCount !== undefined && summary.carrySuccessCount > 0) {
    details.push(
      `carry_success=${formatPercent(
        summary.carrySuccessRate == null ? null : Math.round(summary.carrySuccessRate * 1000) / 10,
      )}`,
    );
  }
  if (summary.topicSwitchCount !== undefined && summary.topicSwitchCount > 0) {
    details.push(`topic_switches=${summary.topicSwitchCount}`);
  }
  const carryRiskSummary = summarizeCarryRiskCounts(summary);
  if (carryRiskSummary) {
    details.push(`carry_risks=${carryRiskSummary}`);
  }
  if ((summary.topAnalysisFrameworks?.length ?? 0) > 0) {
    details.push(
      `lenses=${summary.topAnalysisFrameworks
        .map((entry) => `${entry.frameworkId}:${entry.count}`)
        .join(",")}`,
    );
  }
  if ((summary.topRouteUpgrades?.length ?? 0) > 0) {
    details.push(
      `upgrades=${summary.topRouteUpgrades
        .map((entry) => `${entry.upgradeKind}:${entry.count}`)
        .join(",")}`,
    );
  }
  const backlogSummary = summarizeSemanticBacklog(summary);
  if (backlogSummary) {
    details.push(`backlog=${backlogSummary}`);
  }
  const sampleSummary = summarizeSemanticSamples(summary);
  if (sampleSummary) {
    details.push(`samples=${sampleSummary}`);
  }
  const reviewBacklogSummary = summarizeReviewBacklog(summary);
  if (reviewBacklogSummary) {
    details.push(`review_backlog=${reviewBacklogSummary}`);
  }
  const reviewSampleSummary = summarizeReviewSamples(summary);
  if (reviewSampleSummary) {
    details.push(`review_samples=${reviewSampleSummary}`);
  }
  if ((summary.reviewDeployFollowupCount ?? 0) > 0) {
    details.push(`review_deploy_followups=${summary.reviewDeployFollowupCount}`);
  }
  if (summary.latestOccurredAt) {
    details.push(`latest=${summary.latestOccurredAt}`);
  }
  return details.join(" | ");
}

export function summarizeHermesGatewayLog(logText: string): HermesGatewayLogHealthSummary {
  const commandBridge: HermesCommandBridgeHealthSummary = {
    handledCount: 0,
    fallbackCount: 0,
    latestCommand: null,
    latestResult: null,
    latestAt: null,
  };
  const wecomTransport: HermesWecomTransportHealthSummary = {
    websocketErrorCount: 0,
    reconnectFailureCount: 0,
    reconnectSuccessCount: 0,
    latestWsState: null,
    latestAt: null,
  };

  for (const line of logText.split(/\r?\n/u)) {
    const timestamp = extractLogTimestamp(line);
    const commandBridgeMatch = line.match(
      /htops_hermes_command_bridge command=([^\s]+) result=([^\s]+) chat_id=([^\s]+) user_id=([^\s]+)$/u,
    );
    if (commandBridgeMatch) {
      const command = commandBridgeMatch[1] ?? null;
      const result = commandBridgeMatch[2] ?? null;
      if (result === "handled") {
        commandBridge.handledCount += 1;
      } else {
        commandBridge.fallbackCount += 1;
      }
      commandBridge.latestAt = timestamp;
      commandBridge.latestCommand = command;
      commandBridge.latestResult = result;
      continue;
    }

    const websocketErrorMatch = line.match(/\[Wecom\] WebSocket error: .*?(?:\| ws_state=([^\s]+))?$/u);
    if (websocketErrorMatch) {
      wecomTransport.websocketErrorCount += 1;
      wecomTransport.latestAt = timestamp;
      wecomTransport.latestWsState = websocketErrorMatch[1] ?? null;
      continue;
    }

    const reconnectFailedMatch = line.match(
      /\[Wecom\] Reconnect failed: .*?(?:\| reconnect_attempt=\d+ \| retry_in=([^\s]+) \| ws_state=([^\s]+))?$/u,
    );
    if (reconnectFailedMatch) {
      wecomTransport.reconnectFailureCount += 1;
      wecomTransport.latestAt = timestamp;
      wecomTransport.latestWsState = reconnectFailedMatch[2] ?? null;
      continue;
    }

    const reconnectedMatch = line.match(
      /\[Wecom\] Reconnected(?: \| reconnect_attempt=\d+ \| ws_state=([^\s]+))?$/u,
    );
    if (reconnectedMatch) {
      wecomTransport.reconnectSuccessCount += 1;
      wecomTransport.latestAt = timestamp;
      wecomTransport.latestWsState = reconnectedMatch[1] ?? null;
    }
  }

  return {
    commandBridge:
      commandBridge.handledCount > 0 || commandBridge.fallbackCount > 0 ? commandBridge : null,
    wecomTransport:
      wecomTransport.websocketErrorCount > 0 ||
      wecomTransport.reconnectFailureCount > 0 ||
      wecomTransport.reconnectSuccessCount > 0
        ? wecomTransport
        : null,
  };
}

export function formatHermesGatewayHealthLine(
  summary: HermesGatewayLogHealthSummary,
): string[] {
  const lines: string[] = [];
  if (summary.commandBridge) {
    const details = [
      `Hermes command bridge: handled ${summary.commandBridge.handledCount} / fallback ${summary.commandBridge.fallbackCount}`,
    ];
    if (summary.commandBridge.latestAt) {
      details.push(`latest=${summary.commandBridge.latestAt}`);
    }
    if (summary.commandBridge.latestCommand) {
      details.push(`command=${summary.commandBridge.latestCommand}`);
    }
    if (summary.commandBridge.latestResult) {
      details.push(`result=${summary.commandBridge.latestResult}`);
    }
    lines.push(details.join(" | "));
  }
  if (summary.wecomTransport) {
    const details = [
      `Hermes WeCom transport: websocket_errors ${summary.wecomTransport.websocketErrorCount} / reconnect_failures ${summary.wecomTransport.reconnectFailureCount} / reconnect_successes ${summary.wecomTransport.reconnectSuccessCount}`,
    ];
    if (summary.wecomTransport.latestAt) {
      details.push(`latest=${summary.wecomTransport.latestAt}`);
    }
    if (summary.wecomTransport.latestWsState) {
      details.push(`ws_state=${summary.wecomTransport.latestWsState}`);
    }
    lines.push(details.join(" | "));
  }
  return lines;
}

export async function renderHetangDoctorReport(params: {
  dbUrl: string;
  poolRole: string;
  poolMax: number;
  timeZone: string;
  storeCount: number;
  apiCredentialsConfigured: boolean;
  middayBriefTime: string;
  warningLines: string[];
  schedulerLines: string[];
  telemetryLines: string[];
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
    ...params.warningLines,
    ...params.schedulerLines,
    ...params.telemetryLines,
    ...params.queueLines,
    ...params.storeWatermarks.map(
      (item) => `${item.storeName} (${item.orgId}) -> ${item.summary}`,
    ),
  ].join("\n");
}
