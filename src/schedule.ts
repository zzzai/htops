import { resolveLocalDate, resolveLocalTime, resolveReportBizDate } from "./time.js";
import type { HetangSchedulerJobSummary, ScheduledJob, ScheduledJobType } from "./types.js";

function isTimeReached(nowTime: string, scheduledTime: string): boolean {
  return nowTime >= scheduledTime;
}

function isWithinWindow(nowTime: string, startTime: string, endTime: string): boolean {
  return nowTime >= startTime && nowTime <= endTime;
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
  middayBriefTime: string;
  historyCatchupTime: string;
  reactivationPushTime: string;
  externalIntelligenceTime: string;
  externalIntelligenceEnabled: boolean;
  syncEnabled: boolean;
  reportingEnabled: boolean;
  sendReportEnabled: boolean;
  sendMiddayBriefEnabled: boolean;
  sendReactivationPushEnabled: boolean;
};

type SchedulerDefinition = {
  jobType: ScheduledJobType;
  label: string;
  orchestrator: "sync" | "delivery";
  resolveRunKey: (context: ScheduleContext) => string;
  isEnabled: (context: ScheduleContext) => boolean;
  isDue: (context: ScheduleContext) => boolean;
  describeSchedule: (context: ScheduleContext) => string;
};

const SCHEDULER_JOB_REGISTRY: SchedulerDefinition[] = [
  {
    jobType: "sync",
    label: "夜间同步",
    orchestrator: "sync",
    resolveRunKey: (context) => context.nowDate,
    isEnabled: (context) => context.syncEnabled,
    isDue: (context) =>
      isWithinWindow(context.nowTime, context.syncWindowStart, context.syncWindowEnd) &&
      isTimeReached(context.nowTime, context.syncTime),
    describeSchedule: (context) => `${context.syncTime} within ${context.syncWindowStart}-${context.syncWindowEnd}`,
  },
  {
    jobType: "run-customer-history-catchup",
    label: "顾客历史补齐",
    orchestrator: "sync",
    resolveRunKey: (context) => context.reportRunKey,
    isEnabled: (context) => context.syncEnabled,
    isDue: (context) => isTimeReached(context.nowTime, context.historyCatchupTime),
    describeSchedule: (context) => context.historyCatchupTime,
  },
  {
    jobType: "build-report",
    label: "日报构建",
    orchestrator: "sync",
    resolveRunKey: (context) => context.reportRunKey,
    isEnabled: (context) => context.reportingEnabled,
    isDue: (context) => isTimeReached(context.nowTime, context.buildReportTime),
    describeSchedule: (context) => context.buildReportTime,
  },
  {
    jobType: "build-external-brief",
    label: "外部情报简报",
    orchestrator: "sync",
    resolveRunKey: (context) => context.nowDate,
    isEnabled: (context) => context.externalIntelligenceEnabled,
    isDue: (context) => isTimeReached(context.nowTime, context.externalIntelligenceTime),
    describeSchedule: (context) => context.externalIntelligenceTime,
  },
  {
    jobType: "send-report",
    label: "门店日报投递",
    orchestrator: "delivery",
    resolveRunKey: (context) => context.reportRunKey,
    isEnabled: (context) => context.reportingEnabled && context.sendReportEnabled,
    isDue: (context) => isTimeReached(context.nowTime, context.sendReportTime),
    describeSchedule: (context) => context.sendReportTime,
  },
  {
    jobType: "send-midday-brief",
    label: "午报投递",
    orchestrator: "delivery",
    resolveRunKey: (context) => context.reportRunKey,
    isEnabled: (context) => context.reportingEnabled && context.sendMiddayBriefEnabled,
    isDue: (context) => isTimeReached(context.nowTime, context.middayBriefTime),
    describeSchedule: (context) => context.middayBriefTime,
  },
  {
    jobType: "send-reactivation-push",
    label: "唤回推送",
    orchestrator: "delivery",
    resolveRunKey: (context) => context.reportRunKey,
    isEnabled: (context) => context.reportingEnabled && context.sendReactivationPushEnabled,
    isDue: (context) => isTimeReached(context.nowTime, context.reactivationPushTime),
    describeSchedule: (context) => context.reactivationPushTime,
  },
];

function createScheduleContext(params: {
  now: Date;
  timeZone: string;
  businessDayCutoffLocalTime?: string;
  syncTime?: string;
  syncWindowStart?: string;
  syncWindowEnd?: string;
  buildReportTime?: string;
  sendReportTime?: string;
  middayBriefTime?: string;
  historyCatchupTime?: string;
  reactivationPushTime?: string;
  sendReportEnabled?: boolean;
  sendMiddayBriefEnabled?: boolean;
  sendReactivationPushEnabled?: boolean;
  externalIntelligenceEnabled?: boolean;
  externalIntelligenceTime?: string;
  syncEnabled?: boolean;
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
    syncWindowEnd: params.syncWindowEnd ?? "04:00",
    buildReportTime: params.buildReportTime ?? "08:50",
    sendReportTime: params.sendReportTime ?? "09:00",
    middayBriefTime: params.middayBriefTime ?? "12:00",
    historyCatchupTime: params.historyCatchupTime ?? "04:05",
    reactivationPushTime: params.reactivationPushTime ?? "15:00",
    externalIntelligenceTime: params.externalIntelligenceTime ?? params.buildReportTime ?? "08:50",
    externalIntelligenceEnabled: params.externalIntelligenceEnabled === true,
    syncEnabled: params.syncEnabled !== false,
    reportingEnabled: params.reportingEnabled !== false,
    sendReportEnabled: params.sendReportEnabled !== false,
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
  middayBriefTime?: string;
  historyCatchupTime?: string;
  reactivationPushTime?: string;
  sendReportEnabled?: boolean;
  sendMiddayBriefEnabled?: boolean;
  sendReactivationPushEnabled?: boolean;
  externalIntelligenceEnabled?: boolean;
  externalIntelligenceTime?: string;
  syncEnabled?: boolean;
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
  middayBriefTime?: string;
  historyCatchupTime?: string;
  reactivationPushTime?: string;
  sendReportEnabled?: boolean;
  sendMiddayBriefEnabled?: boolean;
  sendReactivationPushEnabled?: boolean;
  externalIntelligenceEnabled?: boolean;
  externalIntelligenceTime?: string;
  syncEnabled?: boolean;
  reportingEnabled?: boolean;
}): ScheduledJob[] {
  return listAuthoritativeSchedulerJobs(params)
    .filter((job) => job.due && !job.completed)
    .map((job) => ({
      jobType: job.jobType,
      runKey: job.runKey,
    }));
}
