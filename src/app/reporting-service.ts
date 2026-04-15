import { getStoreByOrgId } from "../config.js";
import { hasSufficientSyncCoverage } from "../metrics.js";
import { sendReportMessage, type CommandRunner } from "../notify.js";
import {
  loadLatestCustomerSegmentSnapshot,
  renderReactivationPushMessage,
  selectTopReactivationCandidate,
} from "../reactivation-push.js";
import {
  buildDailyStoreReport,
  renderStoreMiddayBrief,
  type StoreMiddayBriefContext,
} from "../report.js";
import { HetangOpsStore } from "../store.js";
import { resolveReportBizDate, shiftBizDate } from "../time.js";
import type {
  CustomerSegmentRecord,
  DailyStoreReport,
  HetangLogger,
  HetangNotificationTarget,
  HetangOpsConfig,
  MemberReactivationFeatureRecord,
  MemberReactivationStrategyRecord,
} from "../types.js";

type CachedDailyReport = DailyStoreReport & {
  sentAt?: string | null;
  sendStatus?: string | null;
};

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
    markdown.includes("【补充指标】") ||
    /^#\s/iu.test(markdown)
  );
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
    return typeof (store as { getRawIngestionStore?: unknown }).getRawIngestionStore === "function"
      ? (
          store as {
            getRawIngestionStore: () => {
              getEndpointWatermarksForOrg: HetangOpsStore["getEndpointWatermarksForOrg"];
            };
          }
        ).getRawIngestionStore()
      : store;
  }

  private resolveMartDerivedStore(store: HetangOpsStore) {
    return typeof (store as { getMartDerivedStore?: unknown }).getMartDerivedStore === "function"
      ? (
          store as {
            getMartDerivedStore: () => {
              getDailyReport: HetangOpsStore["getDailyReport"];
              listStoreReview7dByDateRange: HetangOpsStore["listStoreReview7dByDateRange"];
              listStoreSummary30dByDateRange: HetangOpsStore["listStoreSummary30dByDateRange"];
              markReportSent: HetangOpsStore["markReportSent"];
            };
          }
        ).getMartDerivedStore()
      : store;
  }

  private resolveQueueAccessControlStore(store: HetangOpsStore) {
    return typeof (store as { getQueueAccessControlStore?: unknown }).getQueueAccessControlStore ===
      "function"
      ? (
          store as {
            getQueueAccessControlStore: () => {
              resolveControlTowerSettings: HetangOpsStore["resolveControlTowerSettings"];
            };
          }
        ).getQueueAccessControlStore()
      : store;
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
    const report = await this.resolveDailyReport({
      store,
      orgId: params.orgId,
      bizDate,
    });

    const message = report.complete
      ? report.markdown
      : [
          `${report.storeName} ${bizDate} 同步异常告警`,
          "该店昨日数据同步未完成，暂不发送正式日报。",
          ...report.alerts.map((alert) => `- ${alert.message}`),
        ].join("\n");

    if (!params.dryRun) {
      await sendReportMessage({
        notification,
        message,
        runCommandWithTimeout: this.deps.runCommandWithTimeout,
      });
      await martStore.markReportSent({
        orgId: params.orgId,
        bizDate,
        sentAt: new Date().toISOString(),
        sendStatus: report.complete ? "sent" : "alert-only",
      });
    }

    return `${storeConfig.storeName}: ${report.complete ? "report sent" : "alert sent"}`;
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
