import type { HetangOpsStore } from "./store.js";
import type { HetangAnalysisJob, HetangLogger } from "./types.js";

const ANALYSIS_JOB_STALE_MS = 15 * 60_000;
const ANALYSIS_DELIVERY_RETRY_BACKOFF_MS = 5 * 60_000;

type DeliverableSubscriberJob = HetangAnalysisJob & {
  subscriberKey: string;
  deliveryChannel: string;
  deliveryTarget: string;
  deliveryAccountId?: string;
  deliveryThreadId?: string;
};

export type AnalysisDeliveryNotification = {
  channel: string;
  target: string;
  accountId?: string;
  threadId?: string;
};

export type HetangAnalysisOrchestratorDeps = {
  logger: HetangLogger;
  getStore: () => Promise<HetangOpsStore>;
  decorateAnalysisJob: (job: HetangAnalysisJob) => Promise<HetangAnalysisJob>;
  sendAnalysisReply: (
    job: HetangAnalysisJob,
    notification?: AnalysisDeliveryNotification,
  ) => Promise<void>;
  autoCreateActionsFromAnalysis: (job: HetangAnalysisJob) => Promise<number>;
  runScopedQueryAnalysis: (job: HetangAnalysisJob) => Promise<string>;
  runCrewAISidecar: (job: HetangAnalysisJob) => Promise<string>;
  shouldNotifyAnalysisFailure: (orgId: string) => Promise<boolean>;
  isScopedQueryAnalysis: (job: HetangAnalysisJob) => boolean;
};

function summarizeUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function resolveDeferredDeliveryTime(now: Date): string {
  return new Date(now.getTime() + ANALYSIS_DELIVERY_RETRY_BACKOFF_MS).toISOString();
}

export class HetangAnalysisOrchestrator {
  constructor(private readonly deps: HetangAnalysisOrchestratorDeps) {}

  private async deferSubscriberDelivery(params: {
    store: HetangOpsStore;
    subscriberKey: string;
    attemptedAt: string;
    errorMessage: string;
  }): Promise<void> {
    if (typeof params.store.markAnalysisSubscriberDeliveryAttempt !== "function") {
      return;
    }
    await params.store.markAnalysisSubscriberDeliveryAttempt({
      subscriberKey: params.subscriberKey,
      attemptedAt: params.attemptedAt,
      errorMessage: params.errorMessage,
      nextDeliveryAfter: resolveDeferredDeliveryTime(new Date(params.attemptedAt)),
    });
  }

  private async deferJobDelivery(params: {
    store: HetangOpsStore;
    jobId: string;
    attemptedAt: string;
    errorMessage: string;
  }): Promise<void> {
    if (typeof params.store.markAnalysisJobDeliveryAttempt !== "function") {
      return;
    }
    await params.store.markAnalysisJobDeliveryAttempt({
      jobId: params.jobId,
      attemptedAt: params.attemptedAt,
      errorMessage: params.errorMessage,
      nextDeliveryAfter: resolveDeferredDeliveryTime(new Date(params.attemptedAt)),
    });
  }

  async runPendingAnalysisJobs(now = new Date()): Promise<string[]> {
    const store = await this.deps.getStore();
    const deliverableSubscription =
      typeof store.getNextDeliverableAnalysisSubscription === "function"
        ? await store.getNextDeliverableAnalysisSubscription(now.toISOString())
        : null;
    if (deliverableSubscription) {
      const deliverableJob = await this.deps.decorateAnalysisJob(deliverableSubscription);
      try {
        await this.deps.sendAnalysisReply(deliverableJob, {
          channel: deliverableSubscription.deliveryChannel,
          target: deliverableSubscription.deliveryTarget,
          accountId: deliverableSubscription.deliveryAccountId,
          threadId: deliverableSubscription.deliveryThreadId,
        });
        await store.markAnalysisSubscriberDelivered?.({
          subscriberKey: deliverableSubscription.subscriberKey,
          deliveredAt: now.toISOString(),
        });
        await store.refreshAnalysisJobDeliveryState?.({
          jobId: deliverableSubscription.jobId,
          deliveredAt: now.toISOString(),
        });
        return [`${deliverableJob.storeName}: analysis reply sent`];
      } catch (error) {
        const message = summarizeUnknownError(error);
        await this.deferSubscriberDelivery({
          store,
          subscriberKey: deliverableSubscription.subscriberKey,
          attemptedAt: now.toISOString(),
          errorMessage: message,
        });
        this.deps.logger.warn(
          `hetang-ops: analysis reply send failed for ${deliverableSubscription.jobId}: ${message}`,
        );
        return [`${deliverableJob.storeName}: analysis reply failed - ${message}`];
      }
    }

    const deliverable = await store.getNextDeliverableAnalysisJob(now.toISOString());
    if (deliverable) {
      const deliverableJob = await this.deps.decorateAnalysisJob(deliverable);
      try {
        await this.deps.sendAnalysisReply(deliverableJob);
        await store.markAnalysisJobDelivered({
          jobId: deliverable.jobId,
          deliveredAt: now.toISOString(),
        });
        return [`${deliverableJob.storeName}: analysis reply sent`];
      } catch (error) {
        const message = summarizeUnknownError(error);
        await this.deferJobDelivery({
          store,
          jobId: deliverable.jobId,
          attemptedAt: now.toISOString(),
          errorMessage: message,
        });
        this.deps.logger.warn(
          `hetang-ops: analysis reply send failed for ${deliverable.jobId}: ${message}`,
        );
        return [`${deliverableJob.storeName}: analysis reply failed - ${message}`];
      }
    }

    const claimed = await store.claimNextPendingAnalysisJob({
      startedAt: now.toISOString(),
      staleBefore: new Date(now.getTime() - ANALYSIS_JOB_STALE_MS).toISOString(),
    });
    if (!claimed) {
      return [];
    }

    const claimedJob = await this.deps.decorateAnalysisJob(claimed);
    const finishedAt = now.toISOString();
    try {
      const resultText = this.deps.isScopedQueryAnalysis(claimedJob)
        ? await this.deps.runScopedQueryAnalysis(claimedJob)
        : await this.deps.runCrewAISidecar(claimedJob);
      await store.completeAnalysisJob({
        jobId: claimedJob.jobId,
        resultText,
        finishedAt,
      });
      const completedJob: HetangAnalysisJob = {
        ...claimedJob,
        status: "completed",
        resultText,
        finishedAt,
        updatedAt: finishedAt,
      };
      try {
        await this.deps.autoCreateActionsFromAnalysis(completedJob);
      } catch (error) {
        const message = summarizeUnknownError(error);
        this.deps.logger.warn(
          `hetang-ops: auto-create actions failed for ${completedJob.jobId}: ${message}`,
        );
      }
      try {
        if (typeof store.getNextDeliverableAnalysisSubscription === "function") {
          const subscriber = await store.getNextDeliverableAnalysisSubscription(finishedAt);
          if (subscriber && subscriber.jobId === completedJob.jobId) {
            await this.deps.sendAnalysisReply(completedJob, {
              channel: subscriber.deliveryChannel,
              target: subscriber.deliveryTarget,
              accountId: subscriber.deliveryAccountId,
              threadId: subscriber.deliveryThreadId,
            });
            await store.markAnalysisSubscriberDelivered?.({
              subscriberKey: subscriber.subscriberKey,
              deliveredAt: finishedAt,
            });
            await store.refreshAnalysisJobDeliveryState?.({
              jobId: completedJob.jobId,
              deliveredAt: finishedAt,
            });
            return [`${completedJob.storeName}: analysis delivered`];
          }
        }
        await this.deps.sendAnalysisReply(completedJob);
        await store.markAnalysisJobDelivered({
          jobId: completedJob.jobId,
          deliveredAt: finishedAt,
        });
        return [`${completedJob.storeName}: analysis delivered`];
      } catch (error) {
        const message = summarizeUnknownError(error);
        if (typeof store.getNextDeliverableAnalysisSubscription === "function") {
          const subscriber = await store.getNextDeliverableAnalysisSubscription(finishedAt);
          if (subscriber && subscriber.jobId === completedJob.jobId) {
            await this.deferSubscriberDelivery({
              store,
              subscriberKey: subscriber.subscriberKey,
              attemptedAt: finishedAt,
              errorMessage: message,
            });
          } else {
            await this.deferJobDelivery({
              store,
              jobId: completedJob.jobId,
              attemptedAt: finishedAt,
              errorMessage: message,
            });
          }
        } else {
          await this.deferJobDelivery({
            store,
            jobId: completedJob.jobId,
            attemptedAt: finishedAt,
            errorMessage: message,
          });
        }
        this.deps.logger.warn(
          `hetang-ops: analysis delivery deferred for ${completedJob.jobId}: ${message}`,
        );
        return [`${completedJob.storeName}: analysis completed`];
      }
    } catch (error) {
      const message = summarizeUnknownError(error);
      await store.failAnalysisJob({
        jobId: claimedJob.jobId,
        errorMessage: message,
        finishedAt,
      });
      const failedJob: HetangAnalysisJob = {
        ...claimedJob,
        status: "failed",
        errorMessage: message,
        finishedAt,
        updatedAt: finishedAt,
      };
      if (!(await this.deps.shouldNotifyAnalysisFailure(failedJob.orgId))) {
        await store.markAllAnalysisSubscribersDelivered?.({
          jobId: failedJob.jobId,
          deliveredAt: finishedAt,
        });
        await store.markAnalysisJobDelivered({
          jobId: failedJob.jobId,
          deliveredAt: finishedAt,
        });
        return [`${claimedJob.storeName}: analysis failed - notification suppressed`];
      }
      try {
        if (typeof store.getNextDeliverableAnalysisSubscription === "function") {
          const subscriber = await store.getNextDeliverableAnalysisSubscription(finishedAt);
          if (subscriber && subscriber.jobId === failedJob.jobId) {
            await this.deps.sendAnalysisReply(failedJob, {
              channel: subscriber.deliveryChannel,
              target: subscriber.deliveryTarget,
              accountId: subscriber.deliveryAccountId,
              threadId: subscriber.deliveryThreadId,
            });
            await store.markAnalysisSubscriberDelivered?.({
              subscriberKey: subscriber.subscriberKey,
              deliveredAt: finishedAt,
            });
            await store.refreshAnalysisJobDeliveryState?.({
              jobId: failedJob.jobId,
              deliveredAt: finishedAt,
            });
            return [`${claimedJob.storeName}: analysis failed - ${message}`];
          }
        }
        await this.deps.sendAnalysisReply(failedJob);
        await store.markAnalysisJobDelivered({
          jobId: failedJob.jobId,
          deliveredAt: finishedAt,
        });
      } catch (deliveryError) {
        const deliveryMessage = summarizeUnknownError(deliveryError);
        if (typeof store.getNextDeliverableAnalysisSubscription === "function") {
          const subscriber = await store.getNextDeliverableAnalysisSubscription(finishedAt);
          if (subscriber && subscriber.jobId === failedJob.jobId) {
            await this.deferSubscriberDelivery({
              store,
              subscriberKey: subscriber.subscriberKey,
              attemptedAt: finishedAt,
              errorMessage: deliveryMessage,
            });
          } else {
            await this.deferJobDelivery({
              store,
              jobId: failedJob.jobId,
              attemptedAt: finishedAt,
              errorMessage: deliveryMessage,
            });
          }
        } else {
          await this.deferJobDelivery({
            store,
            jobId: failedJob.jobId,
            attemptedAt: finishedAt,
            errorMessage: deliveryMessage,
          });
        }
        this.deps.logger.warn(
          `hetang-ops: failed-analysis delivery deferred for ${failedJob.jobId}: ${deliveryMessage}`,
        );
      }
      return [`${claimedJob.storeName}: analysis failed - ${message}`];
    }
  }
}
