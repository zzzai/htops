import controlPlaneContract from "./control-plane-contract.json" with { type: "json" };
import { resolveLocalDate, resolveLocalTime, resolveReportBizDate } from "./time.js";
import type {
  HetangSchedulerJobSummary,
  ScheduledJob,
  ScheduledJobOrchestrator,
  ScheduledJobSurfaceRole,
  ScheduledJobType,
} from "./types.js";

function isTimeReached(nowTime: string, scheduledTime: string): boolean {
  return nowTime >= scheduledTime;
}

function isWithinWindow(nowTime: string, startTime: string, endTime: string): boolean {
  return nowTime >= startTime && nowTime <= endTime;
}

function isMonday(date: string): boolean {
  return new Date(`${date}T00:00:00Z`).getUTCDay() === 1;
}

function isFirstDayOfMonth(date: string): boolean {
  return date.endsWith("-01");
}

function resolvePreviousMonthKey(date: string): string {
  const [yearText, monthText] = date.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const previousMonth = month === 1 ? 12 : month - 1;
  const previousYear = month === 1 ? year - 1 : year;
  return `${previousYear.toFixed(0).padStart(4, "0")}-${previousMonth.toFixed(0).padStart(2, "0")}`;
}

function isOnOrAfterDate(date: string, startDate?: string): boolean {
  return !startDate || date >= startDate;
}

type ScheduleContext = {
  nowDate: string;
  nowTime: string;
  reportRunKey: string;
  syncTime: string;
  syncWindowStart: string;
  syncWindowEnd: string;
  buildReportTime: string;
  sendReportTime: string;
  fiveStoreDailyOverviewTime: string;
  weeklyReportTime: string;
  weeklyReportStartDate?: string;
  monthlyReportTime: string;
  monthlyReportStartMonth?: string;
  weeklyChartTime: string;
  weeklyChartStartDate?: string;
  middayBriefTime: string;
  historyCatchupTime: string;
  conversationReviewTime: string;
  reactivationPushTime: string;
  externalIntelligenceTime: string;
  externalIntelligenceEnabled: boolean;
  syncEnabled: boolean;
  historyBackfillEnabled: boolean;
  reportingEnabled: boolean;
  sendReportEnabled: boolean;
  sendFiveStoreDailyOverviewEnabled: boolean;
  sendWeeklyReportEnabled: boolean;
  sendMonthlyReportEnabled: boolean;
  sendWeeklyChartEnabled: boolean;
  sendMiddayBriefEnabled: boolean;
  sendReactivationPushEnabled: boolean;
};

type SchedulerDefinition = {
  jobType: ScheduledJobType;
  label: string;
  orchestrator: ScheduledJobOrchestrator;
  surfaceRole: ScheduledJobSurfaceRole;
  surfaceNote?: string;
  resolveRunKey: (context: ScheduleContext) => string;
  isEnabled: (context: ScheduleContext) => boolean;
  isDue: (context: ScheduleContext) => boolean;
  describeSchedule: (context: ScheduleContext) => string;
};

type SchedulerCatalogRecord = {
  job_type: ScheduledJobType;
  label: string;
  orchestrator: ScheduledJobOrchestrator;
  surface_role: ScheduledJobSurfaceRole;
  surface_note?: string;
};

export const CONTROL_PLANE_CONTRACT_VERSION = (
  controlPlaneContract as {
    version?: string;
  }
).version;

const SCHEDULER_CATALOG = (
  controlPlaneContract as {
    scheduler_jobs: SchedulerCatalogRecord[];
  }
).scheduler_jobs.map((entry) => ({
  jobType: entry.job_type,
  label: entry.label,
  orchestrator: entry.orchestrator,
  surfaceRole: entry.surface_role,
  surfaceNote: entry.surface_note,
}));

const SCHEDULER_CATALOG_BY_JOB_TYPE = new Map(
  SCHEDULER_CATALOG.map((entry) => [entry.jobType, entry] as const),
);

function resolveSchedulerCatalogEntry(jobType: ScheduledJobType) {
  const entry = SCHEDULER_CATALOG_BY_JOB_TYPE.get(jobType);
  if (!entry) {
    throw new Error(`missing scheduler catalog entry for ${jobType}`);
  }
  return entry;
}

function createSchedulerDefinition(
  jobType: ScheduledJobType,
  params: Omit<SchedulerDefinition, "jobType" | "label" | "orchestrator" | "surfaceRole" | "surfaceNote">,
): SchedulerDefinition {
  const entry = resolveSchedulerCatalogEntry(jobType);
  return {
    jobType,
    label: entry.label,
    orchestrator: entry.orchestrator,
    surfaceRole: entry.surfaceRole,
    surfaceNote: entry.surfaceNote,
    ...params,
  };
}

const SCHEDULER_JOB_REGISTRY: SchedulerDefinition[] = [
  createSchedulerDefinition("sync", {
    resolveRunKey: (context) => context.nowDate,
    isEnabled: (context) => context.syncEnabled,
    isDue: (context) =>
      isWithinWindow(context.nowTime, context.syncWindowStart, context.syncWindowEnd) &&
      isTimeReached(context.nowTime, context.syncTime),
    describeSchedule: (context) =>
      `${context.syncTime} within ${context.syncWindowStart}-${context.syncWindowEnd}`,
  }),
  createSchedulerDefinition("run-customer-history-catchup", {
    resolveRunKey: (context) => context.reportRunKey,
    isEnabled: (context) => context.syncEnabled,
    isDue: (context) => isTimeReached(context.nowTime, context.historyCatchupTime),
    describeSchedule: (context) => context.historyCatchupTime,
  }),
  createSchedulerDefinition("nightly-conversation-review", {
    resolveRunKey: (context) => context.nowDate,
    isEnabled: (context) => context.syncEnabled,
    isDue: (context) => isTimeReached(context.nowTime, context.conversationReviewTime),
    describeSchedule: (context) => context.conversationReviewTime,
  }),
  createSchedulerDefinition("build-store-environment-memory", {
    resolveRunKey: (context) => context.reportRunKey,
    isEnabled: (context) => context.reportingEnabled,
    isDue: (context) => isTimeReached(context.nowTime, context.buildReportTime),
    describeSchedule: (context) => `${context.buildReportTime} before daily report build`,
  }),
  createSchedulerDefinition("build-report", {
    resolveRunKey: (context) => context.reportRunKey,
    isEnabled: (context) => context.reportingEnabled,
    isDue: (context) => isTimeReached(context.nowTime, context.buildReportTime),
    describeSchedule: (context) => context.buildReportTime,
  }),
  createSchedulerDefinition("audit-daily-report-window", {
    resolveRunKey: (context) => context.reportRunKey,
    isEnabled: (context) => context.reportingEnabled,
    isDue: (context) => isTimeReached(context.nowTime, context.buildReportTime),
    describeSchedule: (context) => `${context.buildReportTime} after daily report build`,
  }),
  createSchedulerDefinition("build-external-brief", {
    resolveRunKey: (context) => context.nowDate,
    isEnabled: (context) => context.externalIntelligenceEnabled,
    isDue: (context) => isTimeReached(context.nowTime, context.externalIntelligenceTime),
    describeSchedule: (context) => context.externalIntelligenceTime,
  }),
  createSchedulerDefinition("send-report", {
    resolveRunKey: (context) => context.reportRunKey,
    isEnabled: (context) => context.reportingEnabled && context.sendReportEnabled,
    isDue: (context) => isTimeReached(context.nowTime, context.sendReportTime),
    describeSchedule: (context) => context.sendReportTime,
  }),
  createSchedulerDefinition("send-five-store-daily-overview", {
    resolveRunKey: (context) => context.reportRunKey,
    isEnabled: (context) =>
      context.reportingEnabled &&
      context.sendReportEnabled &&
      context.sendFiveStoreDailyOverviewEnabled,
    isDue: (context) => isTimeReached(context.nowTime, context.fiveStoreDailyOverviewTime),
    describeSchedule: (context) => `${context.fiveStoreDailyOverviewTime} after daily reports`,
  }),
  createSchedulerDefinition("send-weekly-report", {
    resolveRunKey: (context) => context.reportRunKey,
    isEnabled: (context) => context.reportingEnabled && context.sendWeeklyReportEnabled,
    isDue: (context) =>
      isOnOrAfterDate(context.nowDate, context.weeklyReportStartDate) &&
      isMonday(context.nowDate) &&
      isTimeReached(context.nowTime, context.weeklyReportTime),
    describeSchedule: (context) =>
      `Mon ${context.weeklyReportTime} after daily report${
        context.weeklyReportStartDate ? ` from ${context.weeklyReportStartDate}` : ""
      }`,
  }),
  createSchedulerDefinition("send-monthly-report", {
    resolveRunKey: (context) => resolvePreviousMonthKey(context.nowDate),
    isEnabled: (context) => context.reportingEnabled && context.sendMonthlyReportEnabled,
    isDue: (context) =>
      isFirstDayOfMonth(context.nowDate) &&
      isOnOrAfterDate(resolvePreviousMonthKey(context.nowDate), context.monthlyReportStartMonth) &&
      isTimeReached(context.nowTime, context.monthlyReportTime),
    describeSchedule: (context) =>
      `1st ${context.monthlyReportTime} after previous-month daily reports${
        context.monthlyReportStartMonth ? ` from ${context.monthlyReportStartMonth}` : ""
      }`,
  }),
  createSchedulerDefinition("send-weekly-chart", {
    resolveRunKey: (context) => context.reportRunKey,
    isEnabled: (context) => context.reportingEnabled && context.sendWeeklyChartEnabled,
    isDue: (context) =>
      isOnOrAfterDate(context.nowDate, context.weeklyChartStartDate) &&
      isMonday(context.nowDate) &&
      isTimeReached(context.nowTime, context.weeklyChartTime),
    describeSchedule: (context) =>
      `Mon ${context.weeklyChartTime} after weekly report${
        context.weeklyChartStartDate ? ` from ${context.weeklyChartStartDate}` : ""
      }`,
  }),
  createSchedulerDefinition("send-midday-brief", {
    resolveRunKey: (context) => context.reportRunKey,
    isEnabled: (context) => context.reportingEnabled && context.sendMiddayBriefEnabled,
    isDue: (context) => isTimeReached(context.nowTime, context.middayBriefTime),
    describeSchedule: (context) => context.middayBriefTime,
  }),
  createSchedulerDefinition("send-reactivation-push", {
    resolveRunKey: (context) => context.reportRunKey,
    isEnabled: (context) => context.reportingEnabled && context.sendReactivationPushEnabled,
    isDue: (context) => isTimeReached(context.nowTime, context.reactivationPushTime),
    describeSchedule: (context) => context.reactivationPushTime,
  }),
  createSchedulerDefinition("nightly-history-backfill", {
    resolveRunKey: (context) => context.nowDate,
    isEnabled: (context) => context.syncEnabled && context.historyBackfillEnabled,
    isDue: (context) =>
      isWithinWindow(context.nowTime, context.syncWindowStart, context.syncWindowEnd) &&
      isTimeReached(context.nowTime, context.syncTime),
    describeSchedule: (context) =>
      `${context.syncTime} within ${context.syncWindowStart}-${context.syncWindowEnd}`,
  }),
];

export function listAuthoritativeSchedulerCatalog(): Array<{
  jobType: ScheduledJobType;
  label: string;
  orchestrator: ScheduledJobOrchestrator;
  surfaceRole: ScheduledJobSurfaceRole;
  surfaceNote?: string;
}> {
  return [...SCHEDULER_CATALOG];
}

function createScheduleContext(params: {
  now: Date;
  timeZone: string;
  businessDayCutoffLocalTime?: string;
  syncTime?: string;
  syncWindowStart?: string;
  syncWindowEnd?: string;
  buildReportTime?: string;
  sendReportTime?: string;
  fiveStoreDailyOverviewTime?: string;
  weeklyReportTime?: string;
  weeklyReportStartDate?: string;
  monthlyReportTime?: string;
  monthlyReportStartMonth?: string;
  weeklyChartTime?: string;
  weeklyChartStartDate?: string;
  middayBriefTime?: string;
  historyCatchupTime?: string;
  conversationReviewTime?: string;
  reactivationPushTime?: string;
  sendReportEnabled?: boolean;
  sendFiveStoreDailyOverviewEnabled?: boolean;
  sendWeeklyReportEnabled?: boolean;
  sendMonthlyReportEnabled?: boolean;
  sendWeeklyChartEnabled?: boolean;
  sendMiddayBriefEnabled?: boolean;
  sendReactivationPushEnabled?: boolean;
  externalIntelligenceEnabled?: boolean;
  externalIntelligenceTime?: string;
  syncEnabled?: boolean;
  historyBackfillEnabled?: boolean;
  reportingEnabled?: boolean;
}): ScheduleContext {
  return {
    nowDate: resolveLocalDate(params.now, params.timeZone),
    nowTime: resolveLocalTime(params.now, params.timeZone),
    reportRunKey: resolveReportBizDate({
      now: params.now,
      timeZone: params.timeZone,
      cutoffLocalTime: params.businessDayCutoffLocalTime,
    }),
    syncTime: params.syncTime ?? "03:10",
    syncWindowStart: params.syncWindowStart ?? "03:00",
    syncWindowEnd: params.syncWindowEnd ?? "18:00",
    buildReportTime: params.buildReportTime ?? "08:50",
    sendReportTime: params.sendReportTime ?? "09:00",
    fiveStoreDailyOverviewTime: params.fiveStoreDailyOverviewTime ?? "09:05",
    weeklyReportTime: params.weeklyReportTime ?? "09:15",
    weeklyReportStartDate: params.weeklyReportStartDate,
    monthlyReportTime: params.monthlyReportTime ?? "09:25",
    monthlyReportStartMonth: params.monthlyReportStartMonth,
    weeklyChartTime: params.weeklyChartTime ?? "09:18",
    weeklyChartStartDate: params.weeklyChartStartDate,
    middayBriefTime: params.middayBriefTime ?? "12:00",
    historyCatchupTime: params.historyCatchupTime ?? "04:05",
    conversationReviewTime: params.conversationReviewTime ?? "04:20",
    reactivationPushTime: params.reactivationPushTime ?? "15:00",
    externalIntelligenceTime: params.externalIntelligenceTime ?? params.buildReportTime ?? "08:50",
    externalIntelligenceEnabled: params.externalIntelligenceEnabled === true,
    syncEnabled: params.syncEnabled !== false,
    historyBackfillEnabled: params.historyBackfillEnabled !== false,
    reportingEnabled: params.reportingEnabled !== false,
    sendReportEnabled: params.sendReportEnabled !== false,
    sendFiveStoreDailyOverviewEnabled:
      params.sendFiveStoreDailyOverviewEnabled !== false,
    sendWeeklyReportEnabled: params.sendWeeklyReportEnabled !== false,
    sendMonthlyReportEnabled: params.sendMonthlyReportEnabled !== false,
    sendWeeklyChartEnabled: params.sendWeeklyChartEnabled !== false,
    sendMiddayBriefEnabled: params.sendMiddayBriefEnabled !== false,
    sendReactivationPushEnabled: params.sendReactivationPushEnabled !== false,
  };
}

export function listAuthoritativeSchedulerJobs(params: {
  now: Date;
  timeZone: string;
  businessDayCutoffLocalTime?: string;
  completedRunKeys: Set<string>;
  lastRunAtByJobType?: Partial<Record<ScheduledJobType, string>>;
  syncTime?: string;
  syncWindowStart?: string;
  syncWindowEnd?: string;
  buildReportTime?: string;
  sendReportTime?: string;
  fiveStoreDailyOverviewTime?: string;
  weeklyReportTime?: string;
  weeklyReportStartDate?: string;
  monthlyReportTime?: string;
  monthlyReportStartMonth?: string;
  weeklyChartTime?: string;
  weeklyChartStartDate?: string;
  middayBriefTime?: string;
  historyCatchupTime?: string;
  conversationReviewTime?: string;
  reactivationPushTime?: string;
  sendReportEnabled?: boolean;
  sendFiveStoreDailyOverviewEnabled?: boolean;
  sendWeeklyReportEnabled?: boolean;
  sendMonthlyReportEnabled?: boolean;
  sendWeeklyChartEnabled?: boolean;
  sendMiddayBriefEnabled?: boolean;
  sendReactivationPushEnabled?: boolean;
  externalIntelligenceEnabled?: boolean;
  externalIntelligenceTime?: string;
  syncEnabled?: boolean;
  historyBackfillEnabled?: boolean;
  reportingEnabled?: boolean;
}): HetangSchedulerJobSummary[] {
  const context = createScheduleContext(params);
  return SCHEDULER_JOB_REGISTRY.map((definition) => {
    const enabled = definition.isEnabled(context);
    const runKey = definition.resolveRunKey(context);
    const due = enabled && definition.isDue(context);
    const completed = enabled && params.completedRunKeys.has(`${definition.jobType}:${runKey}`);
    const status = !enabled ? "disabled" : completed ? "completed" : due ? "pending" : "waiting";
    return {
      jobType: definition.jobType,
      label: definition.label,
      orchestrator: definition.orchestrator,
      surfaceRole: definition.surfaceRole,
      surfaceNote: definition.surfaceNote,
      schedule: definition.describeSchedule(context),
      enabled,
      runKey,
      due,
      completed,
      status,
      lastRanAt: params.lastRunAtByJobType?.[definition.jobType],
    };
  });
}

export function listDueScheduledJobs(params: {
  now: Date;
  timeZone: string;
  businessDayCutoffLocalTime?: string;
  completedRunKeys: Set<string>;
  syncTime?: string;
  syncWindowStart?: string;
  syncWindowEnd?: string;
  buildReportTime?: string;
  sendReportTime?: string;
  fiveStoreDailyOverviewTime?: string;
  weeklyReportTime?: string;
  weeklyReportStartDate?: string;
  monthlyReportTime?: string;
  monthlyReportStartMonth?: string;
  weeklyChartTime?: string;
  weeklyChartStartDate?: string;
  middayBriefTime?: string;
  historyCatchupTime?: string;
  conversationReviewTime?: string;
  reactivationPushTime?: string;
  sendReportEnabled?: boolean;
  sendFiveStoreDailyOverviewEnabled?: boolean;
  sendWeeklyReportEnabled?: boolean;
  sendMonthlyReportEnabled?: boolean;
  sendWeeklyChartEnabled?: boolean;
  sendMiddayBriefEnabled?: boolean;
  sendReactivationPushEnabled?: boolean;
  externalIntelligenceEnabled?: boolean;
  externalIntelligenceTime?: string;
  syncEnabled?: boolean;
  historyBackfillEnabled?: boolean;
  reportingEnabled?: boolean;
  orchestrators?: ScheduledJobOrchestrator[];
}): ScheduledJob[] {
  const allowedOrchestrators = new Set<ScheduledJobOrchestrator>(
    params.orchestrators && params.orchestrators.length > 0
      ? params.orchestrators
      : ["sync", "delivery"],
  );
  return listAuthoritativeSchedulerJobs(params)
    .filter(
      (job) => job.due && !job.completed && allowedOrchestrators.has(job.orchestrator),
    )
    .map((job) => ({
      jobType: job.jobType,
      runKey: job.runKey,
    }));
}
