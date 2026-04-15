import { resolveReportBizDate } from "./time.js";
import type { HetangOpsStore } from "./store.js";
import type { HetangLogger, HetangNotificationTarget, HetangOpsConfig } from "./types.js";

type DeliveryState = {
  deliveredAtByOrgId: Record<string, string>;
  updatedAt: string;
};

const MIDDAY_DELIVERY_LOCK_SEED = 42_060_511;
const REACTIVATION_DELIVERY_LOCK_SEED = 42_060_512;

export type HetangDeliveryOrchestratorDeps = {
  config: HetangOpsConfig;
  logger: HetangLogger;
  getStore: () => Promise<HetangOpsStore>;
  sendMiddayBrief: (params: {
    orgId: string;
    bizDate?: string;
    now?: Date;
    notificationOverride?: HetangNotificationTarget;
  }) => Promise<string>;
  sendReactivationPush: (params: {
    orgId: string;
    bizDate?: string;
    now?: Date;
    notificationOverride?: HetangNotificationTarget;
  }) => Promise<string>;
  getMiddayBriefDeliveryState: (store: HetangOpsStore, runKey: string) => Promise<DeliveryState>;
  persistMiddayBriefDeliveryState: (
    store: HetangOpsStore,
    runKey: string,
    state: DeliveryState,
  ) => Promise<void>;
  getReactivationPushDeliveryState: (
    store: HetangOpsStore,
    runKey: string,
  ) => Promise<DeliveryState>;
  persistReactivationPushDeliveryState: (
    store: HetangOpsStore,
    runKey: string,
    state: DeliveryState,
  ) => Promise<void>;
};

function summarizeUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function buildDeliveryLockKey(seed: number, runKey: string, orgId: string): number {
  let hash = seed;
  const source = `${runKey}:${orgId}`;
  for (const character of source) {
    hash = (hash * 33 + character.codePointAt(0)!) % 2_147_483_647;
  }
  return hash || seed;
}

export class HetangDeliveryOrchestrator {
  constructor(private readonly deps: HetangDeliveryOrchestratorDeps) {}

  private async sendWithTargetLease(params: {
    store: HetangOpsStore;
    seed: number;
    runKey: string;
    orgId: string;
    readState: () => Promise<DeliveryState>;
    persistState: (state: DeliveryState) => Promise<void>;
    alreadySentLine: string;
    inProgressLine: string;
    send: () => Promise<string>;
    markNow: string;
  }): Promise<{
    line: string;
    delivered: boolean;
    inProgress: boolean;
  }> {
    const lockKey = buildDeliveryLockKey(params.seed, params.runKey, params.orgId);
    const lockAcquired =
      typeof params.store.tryAdvisoryLock === "function"
        ? await params.store.tryAdvisoryLock(lockKey)
        : true;
    if (!lockAcquired) {
      const state = await params.readState();
      return {
        line: state.deliveredAtByOrgId[params.orgId]
          ? params.alreadySentLine
          : params.inProgressLine,
        delivered: Boolean(state.deliveredAtByOrgId[params.orgId]),
        inProgress: !state.deliveredAtByOrgId[params.orgId],
      };
    }

    try {
      const state = await params.readState();
      if (state.deliveredAtByOrgId[params.orgId]) {
        return {
          line: params.alreadySentLine,
          delivered: true,
          inProgress: false,
        };
      }

      const line = await params.send();
      state.deliveredAtByOrgId[params.orgId] = params.markNow;
      state.updatedAt = params.markNow;
      await params.persistState(state);
      return {
        line,
        delivered: true,
        inProgress: false,
      };
    } finally {
      if (typeof params.store.releaseAdvisoryLock === "function") {
        await params.store.releaseAdvisoryLock(lockKey);
      }
    }
  }

  async sendAllMiddayBriefs(params: {
    bizDate?: string;
    now?: Date;
    notificationOverride?: HetangNotificationTarget;
  } = {}): Promise<{ lines: string[]; allSent: boolean }> {
    const bizDate =
      params.bizDate ??
      resolveReportBizDate({
        now: params.now ?? new Date(),
        timeZone: this.deps.config.timeZone,
        cutoffLocalTime: this.deps.config.sync.businessDayCutoffLocalTime,
      });
    const store = await this.deps.getStore();
    const state = await this.deps.getMiddayBriefDeliveryState(store, bizDate);
    const activeStores = this.deps.config.stores.filter((storeConfig) => storeConfig.isActive);
    const lines: string[] = [];
    let allSent = true;
    const markNow = (params.now ?? new Date()).toISOString();
    for (const entry of activeStores) {
      if (state.deliveredAtByOrgId[entry.orgId]) {
        lines.push(`${entry.storeName}: midday brief already sent`);
        continue;
      }
      try {
        const result = await this.sendWithTargetLease({
          store,
          seed: MIDDAY_DELIVERY_LOCK_SEED,
          runKey: bizDate,
          orgId: entry.orgId,
          readState: () => this.deps.getMiddayBriefDeliveryState(store, bizDate),
          persistState: (nextState) =>
            this.deps.persistMiddayBriefDeliveryState(store, bizDate, nextState),
          alreadySentLine: `${entry.storeName}: midday brief already sent`,
          inProgressLine: `${entry.storeName}: midday brief send in progress`,
          send: () =>
            this.deps.sendMiddayBrief({
              orgId: entry.orgId,
              bizDate,
              now: params.now,
              notificationOverride: params.notificationOverride,
            }),
          markNow,
        });
        lines.push(result.line);
        if (result.delivered) {
          state.deliveredAtByOrgId[entry.orgId] = markNow;
          state.updatedAt = markNow;
        }
        if (result.inProgress) {
          allSent = false;
        }
      } catch (error) {
        allSent = false;
        const message = summarizeUnknownError(error);
        this.deps.logger.warn(`hetang-ops: send midday brief failed for ${entry.storeName}: ${message}`);
        lines.push(`${entry.storeName}: midday brief send failed - ${message}`);
      }
    }
    const deliveredCount = activeStores.filter((entry) => state.deliveredAtByOrgId[entry.orgId]).length;
    return {
      lines,
      allSent: allSent && deliveredCount === activeStores.length,
    };
  }

  async sendAllReactivationPushes(params: {
    bizDate?: string;
    now?: Date;
    notificationOverride?: HetangNotificationTarget;
  } = {}): Promise<{ lines: string[]; allSent: boolean }> {
    const bizDate =
      params.bizDate ??
      resolveReportBizDate({
        now: params.now ?? new Date(),
        timeZone: this.deps.config.timeZone,
        cutoffLocalTime: this.deps.config.sync.businessDayCutoffLocalTime,
      });
    const store = await this.deps.getStore();
    const state = await this.deps.getReactivationPushDeliveryState(store, bizDate);
    const activeStores = this.deps.config.stores.filter((storeConfig) => storeConfig.isActive);
    const lines: string[] = [];
    let allSent = true;
    const markNow = (params.now ?? new Date()).toISOString();

    for (const entry of activeStores) {
      if (state.deliveredAtByOrgId[entry.orgId]) {
        lines.push(`${entry.storeName}: reactivation push already sent`);
        continue;
      }
      try {
        const result = await this.sendWithTargetLease({
          store,
          seed: REACTIVATION_DELIVERY_LOCK_SEED,
          runKey: bizDate,
          orgId: entry.orgId,
          readState: () => this.deps.getReactivationPushDeliveryState(store, bizDate),
          persistState: (nextState) =>
            this.deps.persistReactivationPushDeliveryState(store, bizDate, nextState),
          alreadySentLine: `${entry.storeName}: reactivation push already sent`,
          inProgressLine: `${entry.storeName}: reactivation push send in progress`,
          send: () =>
            this.deps.sendReactivationPush({
              orgId: entry.orgId,
              bizDate,
              now: params.now,
              notificationOverride: params.notificationOverride,
            }),
          markNow,
        });
        lines.push(result.line);
        if (result.delivered) {
          state.deliveredAtByOrgId[entry.orgId] = markNow;
          state.updatedAt = markNow;
        }
        if (result.inProgress) {
          allSent = false;
        }
      } catch (error) {
        allSent = false;
        const message = summarizeUnknownError(error);
        this.deps.logger.warn(
          `hetang-ops: send reactivation push failed for ${entry.storeName}: ${message}`,
        );
        lines.push(`${entry.storeName}: reactivation push send failed - ${message}`);
      }
    }

    const deliveredCount = activeStores.filter((entry) => state.deliveredAtByOrgId[entry.orgId]).length;
    return {
      lines,
      allSent: allSent && deliveredCount === activeStores.length,
    };
  }
}
