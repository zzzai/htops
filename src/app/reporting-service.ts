import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

import { getStoreByOrgId } from "../config.js";
import { renderFiveStoreDailyOverview as renderFiveStoreDailyOverviewMarkdown } from "../five-store-daily-overview.js";
import { hasSufficientSyncCoverage } from "../metrics.js";
import { sendReportImage, sendReportMessage, type CommandRunner } from "../notify.js";
import {
  loadLatestCustomerSegmentSnapshot,
  renderReactivationPushMessage,
  selectTopReactivationCandidate,
} from "../customer-growth/reactivation/push.js";
import {
  buildDailyStoreReport,
  renderStoreMiddayBrief,
  type StoreMiddayBriefContext,
} from "../report.js";
import { HetangOpsStore } from "../store.js";
import { resolveReportBizDate, shiftBizDate } from "../time.js";
import {
  buildWeeklyStoreChartDataset,
  buildWeeklyStoreChartImage,
} from "../weekly-chart-image.js";
import {
  listMonthBizDates,
  renderFiveStoreMonthlyTrendReport,
  resolvePreviousMonthKey,
} from "../monthly-report.js";
import {
  loadIndustryContextPayload,
  toIndustryContextRuntime,
} from "../industry-context.js";
import { renderFiveStoreWeeklyReport } from "../weekly-report.js";
import type {
  CustomerSegmentRecord,
  DailyStoreReport,
  FiveStoreDailyOverviewCoreMetrics,
  FiveStoreDailyOverviewInput,
  FiveStoreDailyOverviewStoreSnapshot,
  HetangLogger,
  HetangNotificationTarget,
  HetangOpsConfig,
  MemberReactivationFeatureRecord,
  MemberReactivationStrategyRecord,
  StoreEnvironmentDailySnapshotRecord,
} from "../types.js";

type CachedDailyReport = DailyStoreReport & {
  sentAt?: string | null;
  sendStatus?: string | null;
};

const FIVE_STORE_DAILY_OVERVIEW_JOB_TYPE = "send-five-store-daily-overview";
const FIVE_STORE_DAILY_OVERVIEW_PREVIEW_TARGET: HetangNotificationTarget = {
  channel: "wecom",
  target: "ZhangZhen",
  enabled: true,
};

type FiveStoreDailyOverviewApprovalStage =
  | "pending_confirm"
  | "cancelled"
  | "sent"
  | "failed";

type FiveStoreDailyOverviewDeliveryMode = "direct" | "preview";

type FiveStoreDailyOverviewApprovalState = {
  stage: FiveStoreDailyOverviewApprovalStage;
  previewSentAt?: string;
  previewTarget?: HetangNotificationTarget;
  finalTarget?: HetangNotificationTarget;
  finalMessage?: string;
  finalMessageHash?: string;
  canceledAt?: string;
  canceledBy?: string;
  confirmedAt?: string;
  confirmedBy?: string;
  finalSentAt?: string;
  updatedAt: string;
};

function isAlertOnlyDelivered(report: Pick<CachedDailyReport, "sentAt" | "sendStatus"> | null | undefined): boolean {
  return Boolean(report?.sentAt) && report?.sendStatus === "alert-only";
}

function cloneNotificationTarget(target: HetangNotificationTarget): HetangNotificationTarget {
  return {
    channel: target.channel,
    target: target.target,
    accountId: target.accountId,
    threadId: target.threadId,
    enabled: target.enabled,
  };
}

function normalizeStringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function normalizeNotificationTarget(value: unknown): HetangNotificationTarget | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const channel = normalizeStringField(raw.channel);
  const target = normalizeStringField(raw.target);
  const enabled = typeof raw.enabled === "boolean" ? raw.enabled : undefined;
  if (!channel || !target || enabled === undefined) {
    return undefined;
  }
  return {
    channel,
    target,
    accountId: normalizeStringField(raw.accountId),
    threadId: normalizeStringField(raw.threadId),
    enabled,
  };
}

function hashMessage(message: string): string {
  return createHash("sha256").update(message).digest("hex");
}

function buildFiveStoreDailyOverviewPreviewMessage(finalMessage: string): string {
  return ["【5店昨日经营总览预览】", "请确认后再发店长群。", "", finalMessage].join("\n");
}

function normalizeFiveStoreDailyOverviewApprovalState(
  rawState: Record<string, unknown> | null,
): FiveStoreDailyOverviewApprovalState | null {
  if (!rawState) {
    return null;
  }
  const stage = normalizeStringField(rawState.stage);
  if (
    stage !== "pending_confirm" &&
    stage !== "cancelled" &&
    stage !== "sent" &&
    stage !== "failed"
  ) {
    return null;
  }
  return {
    stage,
    previewSentAt: normalizeStringField(rawState.previewSentAt),
    previewTarget: normalizeNotificationTarget(rawState.previewTarget),
    finalTarget: normalizeNotificationTarget(rawState.finalTarget),
    finalMessage: normalizeStringField(rawState.finalMessage),
    finalMessageHash: normalizeStringField(rawState.finalMessageHash),
    canceledAt: normalizeStringField(rawState.canceledAt),
    canceledBy: normalizeStringField(rawState.canceledBy),
    confirmedAt: normalizeStringField(rawState.confirmedAt),
    confirmedBy: normalizeStringField(rawState.confirmedBy),
    finalSentAt: normalizeStringField(rawState.finalSentAt),
    updatedAt: normalizeStringField(rawState.updatedAt) ?? new Date().toISOString(),
  };
}

function numberSetting(
  settings: Record<string, string | number | boolean>,
  key: string,
): number | undefined {
  const value = settings[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanSetting(
  settings: Record<string, string | number | boolean>,
  key: string,
): boolean | undefined {
  const value = settings[key];
  return typeof value === "boolean" ? value : undefined;
}

function applyAnalysisOverrides(
  config: HetangOpsConfig,
  settings: Record<string, string | number | boolean>,
): HetangOpsConfig {
  return {
    ...config,
    analysis: {
      ...config.analysis,
      revenueDropAlertThreshold:
        numberSetting(settings, "alert.revenueDropThreshold") ??
        config.analysis.revenueDropAlertThreshold,
      clockDropAlertThreshold:
        numberSetting(settings, "alert.clockDropThreshold") ??
        config.analysis.clockDropAlertThreshold,
      antiRatioAlertThreshold:
        numberSetting(settings, "alert.antiRatioThreshold") ??
        config.analysis.antiRatioAlertThreshold,
      lowTechActiveCountThreshold:
        numberSetting(settings, "alert.lowTechActiveCountThreshold") ??
        config.analysis.lowTechActiveCountThreshold,
      lowStoredConsumeRateThreshold:
        numberSetting(settings, "alert.lowStoredConsumeRateThreshold") ??
        config.analysis.lowStoredConsumeRateThreshold,
      sleepingMemberRateAlertThreshold:
        numberSetting(settings, "alert.sleepingMemberRateThreshold") ??
        config.analysis.sleepingMemberRateAlertThreshold,
      highTechCommissionRateThreshold:
        numberSetting(settings, "alert.highTechCommissionRateThreshold") ??
        config.analysis.highTechCommissionRateThreshold,
    },
  };
}

function cachedReportNeedsMarkdownRefresh(report: Pick<DailyStoreReport, "markdown" | "complete">): boolean {
  if (!report.complete) {
    return false;
  }
  const markdown = report.markdown.trim();
  if (markdown.length === 0) {
    return true;
  }
  return (
    markdown.includes("【详细指标】") ||
    !markdown.includes("预估到店人数：") ||
    !markdown.includes("口径：主项总钟数只含足道主项，不含SPA/采耳/小项") ||
    /^#\s/iu.test(markdown)
  );
}

function toFiveStoreDailyOverviewMetrics(report: DailyStoreReport): FiveStoreDailyOverviewCoreMetrics {
  return {
    serviceRevenue: report.metrics.serviceRevenue,
    customerCount: report.metrics.customerCount,
    serviceOrderCount: report.metrics.serviceOrderCount,
    averageTicket: report.metrics.averageTicket,
    totalClockCount: report.metrics.totalClockCount,
    pointClockRate: report.metrics.pointClockRate,
    addClockRate: report.metrics.addClockRate,
    clockEffect: report.metrics.clockEffect,
    rechargeCash: report.metrics.rechargeCash,
    storedConsumeAmount: report.metrics.storedConsumeAmount,
    memberPaymentAmount: report.metrics.memberPaymentAmount,
    effectiveMembers: report.metrics.effectiveMembers,
    newMembers: report.metrics.newMembers,
    sleepingMembers: report.metrics.sleepingMembers,
    sleepingMemberRate: report.metrics.sleepingMemberRate,
    highBalanceSleepingMemberCount: report.metrics.highBalanceSleepingMemberCount,
    highBalanceSleepingMemberAmount: report.metrics.highBalanceSleepingMemberAmount,
    firstChargeUnconsumedMemberCount: report.metrics.firstChargeUnconsumedMemberCount,
    firstChargeUnconsumedMemberAmount: report.metrics.firstChargeUnconsumedMemberAmount,
    memberRepurchaseBaseCustomerCount7d: report.metrics.memberRepurchaseBaseCustomerCount7d,
    memberRepurchaseReturnedCustomerCount7d: report.metrics.memberRepurchaseReturnedCustomerCount7d,
    memberRepurchaseRate7d: report.metrics.memberRepurchaseRate7d,
  };
}

function resolveFiveStoreOverviewBackgroundHint(
  snapshots: Array<StoreEnvironmentDailySnapshotRecord | null | undefined>,
): string | undefined {
  const noteworthy = snapshots.filter(
    (entry): entry is StoreEnvironmentDailySnapshotRecord =>
      entry != null && entry.narrativePolicy !== undefined && entry.narrativePolicy !== "suppress",
  );
  if (noteworthy.length === 0) {
    return undefined;
  }
  const holidayCoreDay = noteworthy.find(
    (entry) => entry.holidayTag === "holiday" && entry.holidayName,
  );
  if (holidayCoreDay?.holidayName) {
    return `昨日处于${holidayCoreDay.holidayName}窗口，跨店对比请结合节假日扰动一起看。`;
  }
  const holidayTransitionDay = noteworthy.find((entry) =>
    ["pre_holiday", "post_holiday", "adjusted_workday"].includes(entry.holidayTag ?? ""),
  );
  if (holidayTransitionDay?.holidayTag === "adjusted_workday") {
    return "昨日处于调休工作日，跨店对比请结合节假日错位扰动一起看。";
  }
  if (holidayTransitionDay?.holidayTag === "pre_holiday") {
    return "昨日处于假日前窗口，跨店对比请结合节前扰动一起看。";
  }
  if (holidayTransitionDay?.holidayTag === "post_holiday") {
    return "昨日处于假后回落窗口，跨店对比请结合节后扰动一起看。";
  }
  if (
    noteworthy.some(
      (entry) =>
        entry.badWeatherTouchPenalty === "medium" || entry.badWeatherTouchPenalty === "high",
    )
  ) {
    return "昨日存在天气扰动，跨店差异需结合天气影响一起看。";
  }
  return "昨日存在环境扰动，跨店对比请结合背景因子一起看。";
}

export class HetangReportingService {
  constructor(
    private readonly deps: {
      config: HetangOpsConfig;
      logger: HetangLogger;
      getStore: () => Promise<HetangOpsStore>;
      runCommandWithTimeout: CommandRunner;
      listCustomerSegments: (params: {
        orgId: string;
        bizDate: string;
      }) => Promise<CustomerSegmentRecord[]>;
      listMemberReactivationFeatures: (params: {
        orgId: string;
        bizDate: string;
      }) => Promise<MemberReactivationFeatureRecord[]>;
      listMemberReactivationStrategies: (params: {
        orgId: string;
        bizDate: string;
      }) => Promise<MemberReactivationStrategyRecord[]>;
    },
  ) {}

  private resolveRawIngestionStore(store: HetangOpsStore) {
    if (typeof (store as { getRawIngestionStore?: unknown }).getRawIngestionStore !== "function") {
      throw new Error("reporting-service requires store.getRawIngestionStore()");
    }
    return (
      store as {
        getRawIngestionStore: () => {
          getEndpointWatermarksForOrg: HetangOpsStore["getEndpointWatermarksForOrg"];
        };
      }
    ).getRawIngestionStore();
  }

  private resolveMartDerivedStore(store: HetangOpsStore) {
    if (typeof (store as { getMartDerivedStore?: unknown }).getMartDerivedStore !== "function") {
      throw new Error("reporting-service requires store.getMartDerivedStore()");
    }
    return (
      store as {
        getMartDerivedStore: () => {
          getDailyReport: HetangOpsStore["getDailyReport"];
          listStoreReview7dByDateRange: HetangOpsStore["listStoreReview7dByDateRange"];
          listStoreSummary30dByDateRange: HetangOpsStore["listStoreSummary30dByDateRange"];
          markReportSent: HetangOpsStore["markReportSent"];
        };
      }
    ).getMartDerivedStore();
  }

  private resolveQueueAccessControlStore(store: HetangOpsStore) {
    if (
      typeof (store as { getQueueAccessControlStore?: unknown }).getQueueAccessControlStore !==
      "function"
    ) {
      throw new Error("reporting-service requires store.getQueueAccessControlStore()");
    }
    return (
      store as {
        getQueueAccessControlStore: () => {
          resolveControlTowerSettings: HetangOpsStore["resolveControlTowerSettings"];
        };
      }
    ).getQueueAccessControlStore();
  }

  private async getFiveStoreDailyOverviewApprovalState(
    store: HetangOpsStore,
    bizDate: string,
  ): Promise<FiveStoreDailyOverviewApprovalState | null> {
    return normalizeFiveStoreDailyOverviewApprovalState(
      await store.getScheduledJobState(FIVE_STORE_DAILY_OVERVIEW_JOB_TYPE, bizDate),
    );
  }

  private async persistFiveStoreDailyOverviewApprovalState(
    store: HetangOpsStore,
    bizDate: string,
    state: FiveStoreDailyOverviewApprovalState,
  ): Promise<void> {
    await store.setScheduledJobState(
      FIVE_STORE_DAILY_OVERVIEW_JOB_TYPE,
      bizDate,
      state as unknown as Record<string, unknown>,
      state.updatedAt,
    );
  }

  private async resolveDailyReport(params: {
    store: HetangOpsStore;
    orgId: string;
    bizDate: string;
  }): Promise<CachedDailyReport> {
    const martStore = this.resolveMartDerivedStore(params.store);
    const queueStore = this.resolveQueueAccessControlStore(params.store);
    const rawStore = this.resolveRawIngestionStore(params.store);
    const cachedReport =
      typeof (martStore as { getDailyReport?: unknown }).getDailyReport === "function"
        ? await (
            martStore as {
              getDailyReport: (orgId: string, bizDate: string) => Promise<CachedDailyReport | null>;
            }
          ).getDailyReport(params.orgId, params.bizDate)
        : null;

    if (cachedReport?.complete && !cachedReportNeedsMarkdownRefresh(cachedReport)) {
      return cachedReport;
    }

    if (cachedReport && !cachedReport.complete) {
      if (typeof rawStore.getEndpointWatermarksForOrg !== "function") {
        return cachedReport;
      }
      const watermarks = await rawStore.getEndpointWatermarksForOrg(params.orgId);
      const coverageComplete = hasSufficientSyncCoverage({
        bizDate: params.bizDate,
        timeZone: this.deps.config.timeZone,
        cutoffLocalTime: this.deps.config.sync.businessDayCutoffLocalTime,
        watermarks,
      });
      if (!coverageComplete) {
        return cachedReport;
      }
    }

    const runtimeConfig = applyAnalysisOverrides(
      this.deps.config,
      await queueStore.resolveControlTowerSettings(params.orgId),
    );
    try {
      return await buildDailyStoreReport({
        config: runtimeConfig,
        store: params.store,
        orgId: params.orgId,
        bizDate: params.bizDate,
      });
    } catch (error) {
      if (cachedReport?.complete && cachedReportNeedsMarkdownRefresh(cachedReport)) {
        const message = error instanceof Error ? error.message : String(error);
        this.deps.logger.warn(
          `hetang-ops: fallback to cached legacy daily report for ${params.orgId} ${params.bizDate}: ${message}`,
        );
        return cachedReport;
      }
      throw error;
    }
  }

  async buildReport(params: {
    orgId: string;
    bizDate?: string;
    now?: Date;
  }): Promise<DailyStoreReport> {
    const store = await this.deps.getStore();
    const baseBizDate =
      params.bizDate ??
      resolveReportBizDate({
        now: params.now ?? new Date(),
        timeZone: this.deps.config.timeZone,
        cutoffLocalTime: this.deps.config.sync.businessDayCutoffLocalTime,
      });
    return await this.resolveDailyReport({
      store,
      orgId: params.orgId,
      bizDate: baseBizDate,
    });
  }

  async buildAllReports(
    params: { bizDate?: string; now?: Date } = {},
  ): Promise<DailyStoreReport[]> {
    return await Promise.all(
      this.deps.config.stores
        .filter((entry) => entry.isActive)
        .map((entry) =>
          this.buildReport({
            orgId: entry.orgId,
            bizDate: params.bizDate,
            now: params.now,
          }),
        ),
    );
  }

  async renderWeeklyReport(params: {
    weekEndBizDate?: string;
    now?: Date;
  } = {}): Promise<string> {
    const weekEndBizDate =
      params.weekEndBizDate ??
      resolveReportBizDate({
        now: params.now ?? new Date(),
        timeZone: this.deps.config.timeZone,
        cutoffLocalTime: this.deps.config.sync.businessDayCutoffLocalTime,
      });
    const store = await this.deps.getStore();
    const martStore = this.resolveMartDerivedStore(store);
    const activeStores = this.deps.config.stores.filter((entry) => entry.isActive);
    const currentBizDates = Array.from({ length: 7 }, (_, index) =>
      shiftBizDate(weekEndBizDate, index - 6),
    );
    const previousBizDates = Array.from({ length: 7 }, (_, index) =>
      shiftBizDate(weekEndBizDate, index - 13),
    );
    const loadWeeklyReport = async (orgId: string, bizDate: string): Promise<CachedDailyReport> => {
      const cachedReport =
        typeof (martStore as { getDailyReport?: unknown }).getDailyReport === "function"
          ? await (
              martStore as {
                getDailyReport: (orgId: string, bizDate: string) => Promise<CachedDailyReport | null>;
              }
            ).getDailyReport(orgId, bizDate)
          : null;
      if (cachedReport) {
        return cachedReport;
      }
      return await this.resolveDailyReport({
        store,
        orgId,
        bizDate,
      });
    };

    const stores = await Promise.all(
      activeStores.map(async (entry) => ({
        orgId: entry.orgId,
        storeName: entry.storeName,
        currentReports: await Promise.all(
          currentBizDates.map((bizDate) => loadWeeklyReport(entry.orgId, bizDate)),
        ),
        previousReports: await Promise.all(
          previousBizDates.map((bizDate) => loadWeeklyReport(entry.orgId, bizDate)),
        ),
      })),
    );
    const industryContext = await loadIndustryContextPayload({
      runtime: toIndustryContextRuntime({
        listIndustryContextSnapshots: async (params) =>
          await store.listIndustryContextSnapshots(params),
      }),
      snapshotDate: weekEndBizDate,
      module: "world_model",
    });

    return renderFiveStoreWeeklyReport({
      weekEndBizDate,
      stores,
      industryObservations: industryContext.observations,
    });
  }

  private async resolveFiveStoreDailyOverviewInput(params: {
    bizDate: string;
    baselineBizDate: string;
  }): Promise<
    | {
        ready: true;
        input: FiveStoreDailyOverviewInput;
      }
    | {
        ready: false;
        incompleteStoreNames: string[];
      }
  > {
    const store = await this.deps.getStore();
    const martStore = this.resolveMartDerivedStore(store);
    const activeStores = this.deps.config.stores.filter((entry) => entry.isActive);
    const snapshots: FiveStoreDailyOverviewStoreSnapshot[] = [];
    const environmentSnapshots: Array<StoreEnvironmentDailySnapshotRecord | null> = [];
    const incompleteStoreNames: string[] = [];

    for (const entry of activeStores) {
      const currentReport = await this.resolveDailyReport({
        store,
        orgId: entry.orgId,
        bizDate: params.bizDate,
      });

      if (!currentReport.complete) {
        incompleteStoreNames.push(entry.storeName);
        continue;
      }

      const cachedBaselineReport =
        typeof (martStore as { getDailyReport?: unknown }).getDailyReport === "function"
          ? await (
              martStore as {
                getDailyReport: (orgId: string, bizDate: string) => Promise<CachedDailyReport | null>;
              }
            ).getDailyReport(entry.orgId, params.baselineBizDate)
          : null;

      let previousWeekSameDay: FiveStoreDailyOverviewCoreMetrics | null = null;
      if (cachedBaselineReport?.complete) {
        previousWeekSameDay = toFiveStoreDailyOverviewMetrics(cachedBaselineReport);
      } else if (cachedBaselineReport === null) {
        try {
          const rebuiltBaselineReport = await this.resolveDailyReport({
            store,
            orgId: entry.orgId,
            bizDate: params.baselineBizDate,
          });
          if (rebuiltBaselineReport.complete) {
            previousWeekSameDay = toFiveStoreDailyOverviewMetrics(rebuiltBaselineReport);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.deps.logger.warn(
            `hetang-ops: five-store daily overview baseline unavailable for ${entry.orgId} ${params.baselineBizDate}: ${message}`,
          );
        }
      }

      snapshots.push({
        orgId: entry.orgId,
        storeName: entry.storeName,
        current: toFiveStoreDailyOverviewMetrics(currentReport),
        previousWeekSameDay,
      });
      environmentSnapshots.push(
        typeof (
          store as {
            getStoreEnvironmentDailySnapshot?: unknown;
          }
        ).getStoreEnvironmentDailySnapshot === "function"
          ? await (
              store as {
                getStoreEnvironmentDailySnapshot: (
                  orgId: string,
                  bizDate: string,
                ) => Promise<StoreEnvironmentDailySnapshotRecord | null>;
              }
            ).getStoreEnvironmentDailySnapshot(entry.orgId, params.bizDate)
          : null,
      );
    }

    if (incompleteStoreNames.length > 0) {
      return {
        ready: false,
        incompleteStoreNames,
      };
    }

    return {
      ready: true,
      input: {
        bizDate: params.bizDate,
        baselineBizDate: params.baselineBizDate,
        backgroundHint: resolveFiveStoreOverviewBackgroundHint(environmentSnapshots),
        stores: snapshots,
      },
    };
  }

  async renderFiveStoreDailyOverview(params: {
    bizDate?: string;
    baselineBizDate?: string;
    now?: Date;
  } = {}): Promise<string> {
    const bizDate =
      params.bizDate ??
      resolveReportBizDate({
        now: params.now ?? new Date(),
        timeZone: this.deps.config.timeZone,
        cutoffLocalTime: this.deps.config.sync.businessDayCutoffLocalTime,
      });
    const baselineBizDate = params.baselineBizDate ?? shiftBizDate(bizDate, -7);
    const payload = await this.resolveFiveStoreDailyOverviewInput({
      bizDate,
      baselineBizDate,
    });

    if (!payload.ready) {
      throw new Error(
        `five-store daily overview ${bizDate} waiting - incomplete reports: ${payload.incompleteStoreNames.join(", ")}`,
      );
    }

    return renderFiveStoreDailyOverviewMarkdown(payload.input);
  }

  async sendReport(params: {
    orgId: string;
    bizDate?: string;
    now?: Date;
    dryRun?: boolean;
  }): Promise<string> {
    const bizDate =
      params.bizDate ??
      resolveReportBizDate({
        now: params.now ?? new Date(),
        timeZone: this.deps.config.timeZone,
        cutoffLocalTime: this.deps.config.sync.businessDayCutoffLocalTime,
      });
    const store = await this.deps.getStore();
    const martStore = this.resolveMartDerivedStore(store);
    const queueStore = this.resolveQueueAccessControlStore(store);
    const storeConfig = getStoreByOrgId(this.deps.config, params.orgId);
    const controlTowerSettings = await queueStore.resolveControlTowerSettings(params.orgId);
    if (booleanSetting(controlTowerSettings, "notification.enabled") === false) {
      return `${storeConfig.storeName}: notification disabled by control tower`;
    }
    const notification = storeConfig.notification ?? this.deps.config.reporting.sharedDelivery;
    if (!notification || !notification.enabled) {
      throw new Error(`No enabled notification target configured for ${storeConfig.storeName}`);
    }
    const existingReport =
      typeof (martStore as { getDailyReport?: unknown }).getDailyReport === "function"
        ? await (
            martStore as {
              getDailyReport: (orgId: string, bizDate: string) => Promise<CachedDailyReport | null>;
            }
          ).getDailyReport(params.orgId, bizDate)
        : null;
    const report = await this.resolveDailyReport({
      store,
      orgId: params.orgId,
      bizDate,
    });
    const upgradingAlertOnly = isAlertOnlyDelivered(existingReport) && report.complete;

    if (isAlertOnlyDelivered(existingReport) && !report.complete) {
      return `${storeConfig.storeName}: alert already sent`;
    }

    const message = report.complete
      ? report.markdown
      : [
          `${report.storeName} ${bizDate} 同步异常告警`,
          "该店昨日数据同步未完成，暂不发送正式日报。",
          ...report.alerts.map((alert) => `- ${alert.message}`),
        ].join("\n");

    if (!params.dryRun) {
      const sentAt = new Date().toISOString();
      await sendReportMessage({
        notification,
        message,
        runCommandWithTimeout: this.deps.runCommandWithTimeout,
      });
      await martStore.markReportSent({
        orgId: params.orgId,
        bizDate,
        sentAt,
        sendStatus: report.complete ? "sent" : "alert-only",
      });
      if (
        upgradingAlertOnly &&
        typeof (
          martStore as {
            recordReportDeliveryUpgrade?: unknown;
          }
        ).recordReportDeliveryUpgrade === "function"
      ) {
        try {
          await (
            martStore as unknown as {
              recordReportDeliveryUpgrade: (params: {
                orgId: string;
                storeName: string;
                bizDate: string;
                alertSentAt?: string;
                upgradedAt: string;
              }) => Promise<void>;
            }
          ).recordReportDeliveryUpgrade({
            orgId: params.orgId,
            storeName: storeConfig.storeName,
            bizDate,
            alertSentAt: existingReport?.sentAt ?? undefined,
            upgradedAt: sentAt,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.deps.logger.warn(
            `hetang-ops: report delivery upgrade telemetry failed for ${params.orgId} ${bizDate}: ${message}`,
          );
        }
      }
    }

    return `${storeConfig.storeName}: ${report.complete ? "report sent" : "alert sent"}`;
  }

  async sendFiveStoreDailyOverview(params: {
    bizDate?: string;
    baselineBizDate?: string;
    now?: Date;
    dryRun?: boolean;
    deliveryMode?: FiveStoreDailyOverviewDeliveryMode;
    notificationOverride?: HetangNotificationTarget;
  }): Promise<string> {
    const bizDate =
      params.bizDate ??
      resolveReportBizDate({
        now: params.now ?? new Date(),
        timeZone: this.deps.config.timeZone,
        cutoffLocalTime: this.deps.config.sync.businessDayCutoffLocalTime,
      });
    const baselineBizDate = params.baselineBizDate ?? shiftBizDate(bizDate, -7);
    const store = await this.deps.getStore();
    const deliveryMode = params.deliveryMode ?? "direct";
    const finalTarget = params.notificationOverride ?? this.deps.config.reporting.sharedDelivery;
    if (!finalTarget || !finalTarget.enabled) {
      return `five-store daily overview ${bizDate}: skipped - no shared delivery configured`;
    }
    const approvalState = await this.getFiveStoreDailyOverviewApprovalState(store, bizDate);
    if (approvalState?.stage === "sent") {
      return `five-store daily overview sent for ${bizDate}`;
    }
    if (deliveryMode === "preview") {
      if (approvalState?.stage === "pending_confirm") {
        return `five-store daily overview ${bizDate}: pending confirmation`;
      }
      if (approvalState?.stage === "cancelled") {
        return `five-store daily overview cancelled for ${bizDate}`;
      }
    }

    const payload = await this.resolveFiveStoreDailyOverviewInput({
      bizDate,
      baselineBizDate,
    });
    if (!payload.ready) {
      return `five-store daily overview ${bizDate}: waiting - daily reports incomplete`;
    }

    const finalMessage = renderFiveStoreDailyOverviewMarkdown(payload.input);
    const sentAt = (params.now ?? new Date()).toISOString();
    if (deliveryMode === "direct") {
      if (!params.dryRun) {
        await sendReportMessage({
          notification: finalTarget,
          message: finalMessage,
          runCommandWithTimeout: this.deps.runCommandWithTimeout,
        });
        await this.persistFiveStoreDailyOverviewApprovalState(store, bizDate, {
          stage: "sent",
          previewSentAt: approvalState?.previewSentAt,
          previewTarget: approvalState?.previewTarget
            ? cloneNotificationTarget(approvalState.previewTarget)
            : undefined,
          finalTarget: cloneNotificationTarget(finalTarget),
          finalMessage,
          finalMessageHash: hashMessage(finalMessage),
          canceledAt: approvalState?.canceledAt,
          canceledBy: approvalState?.canceledBy,
          confirmedAt: approvalState?.confirmedAt,
          confirmedBy: approvalState?.confirmedBy,
          finalSentAt: sentAt,
          updatedAt: sentAt,
        });
      }
      return `five-store daily overview sent for ${bizDate}`;
    }

    if (!params.dryRun) {
      await sendReportMessage({
        notification: FIVE_STORE_DAILY_OVERVIEW_PREVIEW_TARGET,
        message: buildFiveStoreDailyOverviewPreviewMessage(finalMessage),
        runCommandWithTimeout: this.deps.runCommandWithTimeout,
      });
      await this.persistFiveStoreDailyOverviewApprovalState(store, bizDate, {
        stage: "pending_confirm",
        previewSentAt: sentAt,
        previewTarget: cloneNotificationTarget(FIVE_STORE_DAILY_OVERVIEW_PREVIEW_TARGET),
        finalTarget: cloneNotificationTarget(finalTarget),
        finalMessage,
        finalMessageHash: hashMessage(finalMessage),
        updatedAt: sentAt,
      });
    }
    return `five-store daily overview preview sent to ZhangZhen for ${bizDate}`;
  }

  async cancelFiveStoreDailyOverviewSend(params: {
    bizDate?: string;
    canceledAt?: string;
    canceledBy: string;
  }): Promise<string> {
    const effectiveNow = params.canceledAt ? new Date(params.canceledAt) : new Date();
    const bizDate =
      params.bizDate ??
      resolveReportBizDate({
        now: effectiveNow,
        timeZone: this.deps.config.timeZone,
        cutoffLocalTime: this.deps.config.sync.businessDayCutoffLocalTime,
      });
    const store = await this.deps.getStore();
    const approvalState = await this.getFiveStoreDailyOverviewApprovalState(store, bizDate);
    if (approvalState?.stage === "sent") {
      return `five-store daily overview sent for ${bizDate}`;
    }
    if (approvalState?.stage === "cancelled") {
      return `five-store daily overview cancelled for ${bizDate}`;
    }
    if (approvalState?.stage !== "pending_confirm") {
      return `five-store daily overview ${bizDate}: no pending preview`;
    }

    const canceledAt = params.canceledAt ?? effectiveNow.toISOString();
    await this.persistFiveStoreDailyOverviewApprovalState(store, bizDate, {
      ...approvalState,
      previewTarget:
        approvalState.previewTarget ??
        cloneNotificationTarget(FIVE_STORE_DAILY_OVERVIEW_PREVIEW_TARGET),
      finalTarget: approvalState.finalTarget
        ? cloneNotificationTarget(approvalState.finalTarget)
        : undefined,
      stage: "cancelled",
      canceledAt,
      canceledBy: params.canceledBy,
      updatedAt: canceledAt,
    });
    await store.markScheduledJobCompleted(
      FIVE_STORE_DAILY_OVERVIEW_JOB_TYPE,
      bizDate,
      canceledAt,
    );
    return `five-store daily overview cancelled for ${bizDate}`;
  }

  async confirmFiveStoreDailyOverviewSend(params: {
    bizDate?: string;
    confirmedAt?: string;
    confirmedBy: string;
  }): Promise<string> {
    const effectiveNow = params.confirmedAt ? new Date(params.confirmedAt) : new Date();
    const bizDate =
      params.bizDate ??
      resolveReportBizDate({
        now: effectiveNow,
        timeZone: this.deps.config.timeZone,
        cutoffLocalTime: this.deps.config.sync.businessDayCutoffLocalTime,
      });
    const store = await this.deps.getStore();
    const approvalState = await this.getFiveStoreDailyOverviewApprovalState(store, bizDate);
    if (approvalState?.stage === "sent") {
      return `five-store daily overview sent for ${bizDate}`;
    }
    if (approvalState?.stage === "cancelled") {
      return `five-store daily overview cancelled for ${bizDate}`;
    }
    if (
      approvalState?.stage !== "pending_confirm" ||
      !approvalState.finalTarget ||
      !approvalState.finalMessage
    ) {
      return `five-store daily overview ${bizDate}: no pending preview`;
    }

    const confirmedAt = params.confirmedAt ?? effectiveNow.toISOString();
    await sendReportMessage({
      notification: approvalState.finalTarget,
      message: approvalState.finalMessage,
      runCommandWithTimeout: this.deps.runCommandWithTimeout,
    });
    await this.persistFiveStoreDailyOverviewApprovalState(store, bizDate, {
      ...approvalState,
      previewTarget:
        approvalState.previewTarget ??
        cloneNotificationTarget(FIVE_STORE_DAILY_OVERVIEW_PREVIEW_TARGET),
      finalTarget: cloneNotificationTarget(approvalState.finalTarget),
      stage: "sent",
      finalMessageHash: approvalState.finalMessageHash ?? hashMessage(approvalState.finalMessage),
      confirmedAt,
      confirmedBy: params.confirmedBy,
      finalSentAt: confirmedAt,
      updatedAt: confirmedAt,
    });
    await store.markScheduledJobCompleted(
      FIVE_STORE_DAILY_OVERVIEW_JOB_TYPE,
      bizDate,
      confirmedAt,
    );
    return `five-store daily overview sent for ${bizDate}`;
  }

  async sendWeeklyReport(params: {
    weekEndBizDate?: string;
    now?: Date;
    dryRun?: boolean;
    notificationOverride?: HetangNotificationTarget;
  }): Promise<string> {
    const weekEndBizDate =
      params.weekEndBizDate ??
      resolveReportBizDate({
        now: params.now ?? new Date(),
        timeZone: this.deps.config.timeZone,
        cutoffLocalTime: this.deps.config.sync.businessDayCutoffLocalTime,
      });
    const notification =
      params.notificationOverride ?? this.deps.config.reporting.sharedDelivery;
    if (!notification || !notification.enabled) {
      return `weekly report ${weekEndBizDate}: skipped - no shared delivery configured`;
    }
    const message = await this.renderWeeklyReport({
      weekEndBizDate,
      now: params.now,
    });
    if (!params.dryRun) {
      await sendReportMessage({
        notification,
        message,
        runCommandWithTimeout: this.deps.runCommandWithTimeout,
      });
    }
    return `weekly report sent for ${weekEndBizDate}`;
  }

  async renderMonthlyReport(params: {
    month?: string;
    now?: Date;
  } = {}): Promise<string> {
    const reportBizDate = resolveReportBizDate({
      now: params.now ?? new Date(),
      timeZone: this.deps.config.timeZone,
      cutoffLocalTime: this.deps.config.sync.businessDayCutoffLocalTime,
    });
    const month = params.month ?? reportBizDate.slice(0, 7);
    const previousMonth = resolvePreviousMonthKey(month);
    const currentBizDates = listMonthBizDates(month);
    const previousBizDates = listMonthBizDates(previousMonth);
    const store = await this.deps.getStore();
    const martStore = this.resolveMartDerivedStore(store);
    const activeStores = this.deps.config.stores.filter((entry) => entry.isActive);
    const loadMonthlyReport = async (orgId: string, bizDate: string): Promise<CachedDailyReport> => {
      const cachedReport =
        typeof (martStore as { getDailyReport?: unknown }).getDailyReport === "function"
          ? await (
              martStore as {
                getDailyReport: (orgId: string, bizDate: string) => Promise<CachedDailyReport | null>;
              }
            ).getDailyReport(orgId, bizDate)
          : null;
      if (cachedReport) {
        return cachedReport;
      }
      return await this.resolveDailyReport({
        store,
        orgId,
        bizDate,
      });
    };

    return renderFiveStoreMonthlyTrendReport({
      month,
      stores: await Promise.all(
        activeStores.map(async (entry) => ({
          orgId: entry.orgId,
          storeName: entry.storeName,
          currentReports: await Promise.all(
            currentBizDates.map((bizDate) => loadMonthlyReport(entry.orgId, bizDate)),
          ),
          previousReports: await Promise.all(
            previousBizDates.map((bizDate) => loadMonthlyReport(entry.orgId, bizDate)),
          ),
        })),
      ),
    });
  }

  async sendMonthlyReport(params: {
    month?: string;
    now?: Date;
    dryRun?: boolean;
    notificationOverride?: HetangNotificationTarget;
  }): Promise<string> {
    const reportBizDate = resolveReportBizDate({
      now: params.now ?? new Date(),
      timeZone: this.deps.config.timeZone,
      cutoffLocalTime: this.deps.config.sync.businessDayCutoffLocalTime,
    });
    const month = params.month ?? reportBizDate.slice(0, 7);
    const notification = params.notificationOverride ?? this.deps.config.reporting.sharedDelivery;
    if (!notification || !notification.enabled) {
      return `monthly report ${month}: skipped - no shared delivery configured`;
    }
    const message = await this.renderMonthlyReport({
      month,
      now: params.now,
    });
    if (!params.dryRun) {
      await sendReportMessage({
        notification,
        message,
        runCommandWithTimeout: this.deps.runCommandWithTimeout,
      });
    }
    return `monthly report sent for ${month}`;
  }

  async renderWeeklyChartImage(params: {
    weekEndBizDate?: string;
    now?: Date;
  }): Promise<string> {
    const weekEndBizDate =
      params.weekEndBizDate ??
      resolveReportBizDate({
        now: params.now ?? new Date(),
        timeZone: this.deps.config.timeZone,
        cutoffLocalTime: this.deps.config.sync.businessDayCutoffLocalTime,
      });
    const store = await this.deps.getStore();
    const martStore = this.resolveMartDerivedStore(store);
    const activeStores = this.deps.config.stores.filter((entry) => entry.isActive);
    const currentBizDates = Array.from({ length: 7 }, (_, index) =>
      shiftBizDate(weekEndBizDate, index - 6),
    );
    const previousBizDates = Array.from({ length: 7 }, (_, index) =>
      shiftBizDate(weekEndBizDate, index - 13),
    );
    const loadWeeklyReport = async (orgId: string, bizDate: string): Promise<CachedDailyReport> => {
      const cachedReport =
        typeof (martStore as { getDailyReport?: unknown }).getDailyReport === "function"
          ? await (
              martStore as {
                getDailyReport: (orgId: string, bizDate: string) => Promise<CachedDailyReport | null>;
              }
            ).getDailyReport(orgId, bizDate)
          : null;
      if (cachedReport) {
        return cachedReport;
      }
      return await this.resolveDailyReport({
        store,
        orgId,
        bizDate,
      });
    };

    const dataset = buildWeeklyStoreChartDataset({
      weekEndBizDate,
      stores: await Promise.all(
        activeStores.map(async (entry) => ({
          orgId: entry.orgId,
          storeName: entry.storeName,
          currentReports: await Promise.all(
            currentBizDates.map((bizDate) => loadWeeklyReport(entry.orgId, bizDate)),
          ),
          previousReports: await Promise.all(
            previousBizDates.map((bizDate) => loadWeeklyReport(entry.orgId, bizDate)),
          ),
        })),
      ),
    });

    return await buildWeeklyStoreChartImage({
      dataset,
      outputDir: path.join(os.tmpdir(), "htops-weekly-charts"),
      runCommandWithTimeout: this.deps.runCommandWithTimeout,
    });
  }

  async sendWeeklyChartImage(params: {
    weekEndBizDate?: string;
    now?: Date;
    dryRun?: boolean;
    notificationOverride?: HetangNotificationTarget;
  }): Promise<string> {
    const weekEndBizDate =
      params.weekEndBizDate ??
      resolveReportBizDate({
        now: params.now ?? new Date(),
        timeZone: this.deps.config.timeZone,
        cutoffLocalTime: this.deps.config.sync.businessDayCutoffLocalTime,
      });
    const notification =
      params.notificationOverride ?? this.deps.config.reporting.sharedDelivery;
    if (!notification || !notification.enabled) {
      return `weekly chart image ${weekEndBizDate}: skipped - no shared delivery configured`;
    }
    const imagePath = await this.renderWeeklyChartImage({
      weekEndBizDate,
      now: params.now,
    });
    if (params.dryRun) {
      return `weekly chart image ready for ${weekEndBizDate}: ${imagePath}`;
    }
    await sendReportImage({
      notification,
      filePath: imagePath,
      runCommandWithTimeout: this.deps.runCommandWithTimeout,
    });
    return `weekly chart image sent for ${weekEndBizDate}`;
  }

  private async resolveMiddayBriefContext(params: {
    store: HetangOpsStore;
    orgId: string;
    bizDate: string;
  }): Promise<StoreMiddayBriefContext> {
    const martStore = this.resolveMartDerivedStore(params.store);
    const context: StoreMiddayBriefContext = {};
    const currentReviewEnd = params.bizDate;
    const previousReviewEnd = shiftBizDate(params.bizDate, -7);
    const currentSummaryEnd = params.bizDate;
    const previousSummaryEnd = shiftBizDate(params.bizDate, -30);

    try {
      const reviewRows = await martStore.listStoreReview7dByDateRange(
        params.orgId,
        previousReviewEnd,
        currentReviewEnd,
      );
      const reviewByDate = new Map(reviewRows.map((row) => [row.windowEndBizDate, row]));
      context.review7d = {
        current: reviewByDate.get(currentReviewEnd) ?? null,
        previous: reviewByDate.get(previousReviewEnd) ?? null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.logger.warn(
        `hetang-ops: midday brief 7d context unavailable for ${params.orgId} ${params.bizDate}: ${message}`,
      );
    }

    try {
      const summaryRows = await martStore.listStoreSummary30dByDateRange(
        params.orgId,
        previousSummaryEnd,
        currentSummaryEnd,
      );
      const summaryByDate = new Map(summaryRows.map((row) => [row.windowEndBizDate, row]));
      context.summary30d = {
        current: summaryByDate.get(currentSummaryEnd) ?? null,
        previous: summaryByDate.get(previousSummaryEnd) ?? null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.logger.warn(
        `hetang-ops: midday brief 30d context unavailable for ${params.orgId} ${params.bizDate}: ${message}`,
      );
    }

    return context;
  }

  private async hasCompleteDailySyncForDelivery(params: {
    store: HetangOpsStore;
    orgId: string;
    bizDate: string;
  }): Promise<boolean> {
    const store = this.resolveRawIngestionStore(params.store) as {
      getEndpointWatermarksForOrg?: (orgId: string) => Promise<Record<string, string>>;
    };
    if (typeof store.getEndpointWatermarksForOrg !== "function") {
      return true;
    }
    const watermarks = await store.getEndpointWatermarksForOrg(params.orgId);
    return hasSufficientSyncCoverage({
      bizDate: params.bizDate,
      timeZone: this.deps.config.timeZone,
      cutoffLocalTime: this.deps.config.sync.businessDayCutoffLocalTime,
      watermarks,
    });
  }

  async sendMiddayBrief(params: {
    orgId: string;
    bizDate?: string;
    now?: Date;
    dryRun?: boolean;
    notificationOverride?: HetangNotificationTarget;
  }): Promise<string> {
    const bizDate =
      params.bizDate ??
      resolveReportBizDate({
        now: params.now ?? new Date(),
        timeZone: this.deps.config.timeZone,
        cutoffLocalTime: this.deps.config.sync.businessDayCutoffLocalTime,
      });
    const store = await this.deps.getStore();
    const queueStore = this.resolveQueueAccessControlStore(store);
    const storeConfig = getStoreByOrgId(this.deps.config, params.orgId);
    const controlTowerSettings = await queueStore.resolveControlTowerSettings(params.orgId);
    if (booleanSetting(controlTowerSettings, "notification.enabled") === false) {
      return `${storeConfig.storeName}: notification disabled by control tower`;
    }
    const notification =
      params.notificationOverride ??
      storeConfig.notification ??
      this.deps.config.reporting.sharedDelivery;
    if (!notification || !notification.enabled) {
      throw new Error(`No enabled notification target configured for ${storeConfig.storeName}`);
    }

    const syncComplete = await this.hasCompleteDailySyncForDelivery({
      store,
      orgId: params.orgId,
      bizDate,
    });
    if (!syncComplete) {
      return `${storeConfig.storeName}: midday brief skipped - report incomplete`;
    }

    const report = await this.resolveDailyReport({
      store,
      orgId: params.orgId,
      bizDate,
    });
    if (!report.complete) {
      return `${storeConfig.storeName}: midday brief skipped - report incomplete`;
    }

    const middayContext = await this.resolveMiddayBriefContext({
      store,
      orgId: params.orgId,
      bizDate,
    });
    const message = renderStoreMiddayBrief(report, middayContext);

    if (!params.dryRun) {
      await sendReportMessage({
        notification,
        message,
        runCommandWithTimeout: this.deps.runCommandWithTimeout,
      });
    }

    return `${storeConfig.storeName}: midday brief sent`;
  }

  async renderMiddayBrief(params: {
    orgId: string;
    bizDate?: string;
    now?: Date;
  }): Promise<string> {
    const bizDate =
      params.bizDate ??
      resolveReportBizDate({
        now: params.now ?? new Date(),
        timeZone: this.deps.config.timeZone,
        cutoffLocalTime: this.deps.config.sync.businessDayCutoffLocalTime,
      });
    const store = await this.deps.getStore();
    const report = await this.resolveDailyReport({
      store,
      orgId: params.orgId,
      bizDate,
    });
    const middayContext = await this.resolveMiddayBriefContext({
      store,
      orgId: params.orgId,
      bizDate,
    });
    return renderStoreMiddayBrief(report, middayContext);
  }

  async sendReactivationPush(params: {
    orgId: string;
    bizDate?: string;
    now?: Date;
    dryRun?: boolean;
    notificationOverride?: HetangNotificationTarget;
  }): Promise<string> {
    const bizDate =
      params.bizDate ??
      resolveReportBizDate({
        now: params.now ?? new Date(),
        timeZone: this.deps.config.timeZone,
        cutoffLocalTime: this.deps.config.sync.businessDayCutoffLocalTime,
      });
    const store = await this.deps.getStore();
    const queueStore = this.resolveQueueAccessControlStore(store);
    const storeConfig = getStoreByOrgId(this.deps.config, params.orgId);
    const controlTowerSettings = await queueStore.resolveControlTowerSettings(params.orgId);
    if (booleanSetting(controlTowerSettings, "notification.enabled") === false) {
      return `${storeConfig.storeName}: notification disabled by control tower`;
    }
    const notification =
      params.notificationOverride ??
      storeConfig.notification ??
      this.deps.config.reporting.sharedDelivery;
    if (!notification || !notification.enabled) {
      throw new Error(`No enabled notification target configured for ${storeConfig.storeName}`);
    }

    const syncComplete = await this.hasCompleteDailySyncForDelivery({
      store,
      orgId: params.orgId,
      bizDate,
    });
    if (!syncComplete) {
      return `${storeConfig.storeName}: reactivation push skipped - report incomplete`;
    }

    const snapshot = await loadLatestCustomerSegmentSnapshot({
      runtime: {
        listCustomerSegments: (query) => this.deps.listCustomerSegments(query),
      },
      orgId: params.orgId,
      targetBizDate: bizDate,
    });
    if (snapshot.bizDate !== bizDate) {
      return `${storeConfig.storeName}: reactivation push skipped - stale segment snapshot ${snapshot.bizDate}`;
    }
    const featureRows = await this.deps.listMemberReactivationFeatures({
      orgId: params.orgId,
      bizDate: snapshot.bizDate,
    });
    const strategyRows = await this.deps.listMemberReactivationStrategies({
      orgId: params.orgId,
      bizDate: snapshot.bizDate,
    });
    const candidate = selectTopReactivationCandidate(snapshot.rows, featureRows, strategyRows);
    if (!candidate) {
      return `${storeConfig.storeName}: reactivation push skipped - no qualified candidate`;
    }
    const message = renderReactivationPushMessage({
      storeName: storeConfig.storeName,
      snapshotBizDate: snapshot.bizDate,
      candidate,
    });

    if (!params.dryRun) {
      await sendReportMessage({
        notification,
        message,
        runCommandWithTimeout: this.deps.runCommandWithTimeout,
      });
    }

    return `${storeConfig.storeName}: reactivation push sent`;
  }
}
