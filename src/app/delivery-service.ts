import { HetangDeliveryOrchestrator } from "../delivery-orchestrator.js";
import { HetangOpsStore } from "../store.js";
import type { HetangLogger, HetangNotificationTarget, HetangOpsConfig } from "../types.js";

type DeliveryState = {
  deliveredAtByOrgId: Record<string, string>;
  updatedAt: string;
};

function normalizeDeliveryState(rawState: Record<string, unknown> | null): DeliveryState {
  const deliveredAtByOrgId =
    rawState && rawState.deliveredAtByOrgId && typeof rawState.deliveredAtByOrgId === "object"
      ? Object.fromEntries(
          Object.entries(rawState.deliveredAtByOrgId as Record<string, unknown>).filter(
            ([orgId, deliveredAt]) =>
              typeof orgId === "string" &&
              orgId.trim().length > 0 &&
              typeof deliveredAt === "string" &&
              deliveredAt.trim().length > 0,
          ),
        )
      : {};
  const updatedAt =
    rawState && typeof rawState.updatedAt === "string" && rawState.updatedAt.trim().length > 0
      ? rawState.updatedAt
      : new Date().toISOString();
  return {
    deliveredAtByOrgId: deliveredAtByOrgId as Record<string, string>,
    updatedAt,
  };
}

export class HetangDeliveryService {
  private orchestrator: HetangDeliveryOrchestrator | null = null;

  constructor(
    private readonly deps: {
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
    },
  ) {}

  private async getMiddayBriefDeliveryState(
    store: HetangOpsStore,
    runKey: string,
  ): Promise<DeliveryState> {
    return normalizeDeliveryState(await store.getScheduledJobState("send-midday-brief", runKey));
  }

  private async persistMiddayBriefDeliveryState(
    store: HetangOpsStore,
    runKey: string,
    state: DeliveryState,
  ): Promise<void> {
    await store.setScheduledJobState(
      "send-midday-brief",
      runKey,
      state as unknown as Record<string, unknown>,
      state.updatedAt,
    );
  }

  private async getReactivationPushDeliveryState(
    store: HetangOpsStore,
    runKey: string,
  ): Promise<DeliveryState> {
    return normalizeDeliveryState(
      await store.getScheduledJobState("send-reactivation-push", runKey),
    );
  }

  private async persistReactivationPushDeliveryState(
    store: HetangOpsStore,
    runKey: string,
    state: DeliveryState,
  ): Promise<void> {
    await store.setScheduledJobState(
      "send-reactivation-push",
      runKey,
      state as unknown as Record<string, unknown>,
      state.updatedAt,
    );
  }

  private getOrchestrator(): HetangDeliveryOrchestrator {
    if (!this.orchestrator) {
      this.orchestrator = new HetangDeliveryOrchestrator({
        config: this.deps.config,
        logger: this.deps.logger,
        getStore: () => this.deps.getStore(),
        sendMiddayBrief: (params) => this.deps.sendMiddayBrief(params),
        sendReactivationPush: (params) => this.deps.sendReactivationPush(params),
        getMiddayBriefDeliveryState: (store, runKey) =>
          this.getMiddayBriefDeliveryState(store, runKey),
        persistMiddayBriefDeliveryState: (store, runKey, state) =>
          this.persistMiddayBriefDeliveryState(store, runKey, state),
        getReactivationPushDeliveryState: (store, runKey) =>
          this.getReactivationPushDeliveryState(store, runKey),
        persistReactivationPushDeliveryState: (store, runKey, state) =>
          this.persistReactivationPushDeliveryState(store, runKey, state),
      });
    }
    return this.orchestrator;
  }

  reset(): void {
    this.orchestrator = null;
  }

  async sendAllMiddayBriefs(
    params: {
      bizDate?: string;
      now?: Date;
      notificationOverride?: HetangNotificationTarget;
    } = {},
  ): Promise<{ lines: string[]; allSent: boolean }> {
    return await this.getOrchestrator().sendAllMiddayBriefs(params);
  }

  async sendAllReactivationPushes(
    params: {
      bizDate?: string;
      now?: Date;
      notificationOverride?: HetangNotificationTarget;
    } = {},
  ): Promise<{ lines: string[]; allSent: boolean }> {
    return await this.getOrchestrator().sendAllReactivationPushes(params);
  }
}
