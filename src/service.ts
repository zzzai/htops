import { HetangOpsRuntime } from "./runtime.js";
import type { HetangServiceWorkerMode, ScheduledJobOrchestrator } from "./types.js";

const DEFAULT_SCHEDULE_POLL_INTERVAL_MS = 60_000;
const DEFAULT_ANALYSIS_POLL_INTERVAL_MS = 10_000;

export type HetangManagedService = {
  id: string;
  start?: () => Promise<void> | void;
  stop?: () => Promise<void> | void;
};

export function createHetangOpsService(
  runtime: HetangOpsRuntime,
  options: {
    mode?: HetangServiceWorkerMode;
    schedulePollIntervalMs?: number;
    analysisPollIntervalMs?: number;
    unrefTimers?: boolean;
  } = {},
): HetangManagedService {
  const mode = options.mode ?? "all";
  const enableScheduled = mode === "all" || mode === "scheduled";
  const enableAnalysis = mode === "all" || mode === "analysis";
  const schedulePollIntervalMs = options.schedulePollIntervalMs ?? DEFAULT_SCHEDULE_POLL_INTERVAL_MS;
  const analysisPollIntervalMs = options.analysisPollIntervalMs ?? DEFAULT_ANALYSIS_POLL_INTERVAL_MS;
  const unrefTimers = options.unrefTimers ?? true;
  const scopedScheduledRunner =
    typeof (
      runtime as HetangOpsRuntime & {
        runDueJobsByOrchestrator?: (
          orchestrator: ScheduledJobOrchestrator,
          now?: Date,
        ) => Promise<string[]>;
      }
    ).runDueJobsByOrchestrator === "function"
      ? (
          runtime as HetangOpsRuntime & {
            runDueJobsByOrchestrator: (
              orchestrator: ScheduledJobOrchestrator,
              now?: Date,
            ) => Promise<string[]>;
          }
        ).runDueJobsByOrchestrator.bind(runtime)
      : null;

  let scheduledTimer: ReturnType<typeof setInterval> | null = null;
  let scheduledSyncTimer: ReturnType<typeof setInterval> | null = null;
  let scheduledDeliveryTimer: ReturnType<typeof setInterval> | null = null;
  let analysisTimer: ReturnType<typeof setInterval> | null = null;
  let scheduledInFlight: Promise<void> | null = null;
  let scheduledSyncInFlight: Promise<void> | null = null;
  let scheduledDeliveryInFlight: Promise<void> | null = null;
  let analysisInFlight: Promise<void> | null = null;
  let stopped = false;

  const runScheduled = () => {
    if (scheduledInFlight) {
      return scheduledInFlight;
    }
    const now = new Date();
    const startedAt = now.toISOString();
    scheduledInFlight = runtime
      .runDueJobs(now)
      .then(async (lines) => {
        await runtime.recordServicePollerOutcome({
          poller: "scheduled-sync",
          status: "ok",
          startedAt,
          finishedAt: new Date().toISOString(),
          lines,
        });
      })
      .catch(async (error) => {
        await runtime.recordServicePollerOutcome({
          poller: "scheduled-sync",
          status: "failed",
          startedAt,
          finishedAt: new Date().toISOString(),
          error,
        });
      })
      .finally(() => {
        scheduledInFlight = null;
      });
    return scheduledInFlight;
  };

  const runScheduledScoped = (orchestrator: ScheduledJobOrchestrator) => {
    const currentInFlight =
      orchestrator === "sync" ? scheduledSyncInFlight : scheduledDeliveryInFlight;
    if (currentInFlight) {
      return currentInFlight;
    }
    const now = new Date();
    const startedAt = now.toISOString();
    const poller = orchestrator === "sync" ? "scheduled-sync" : "scheduled-delivery";
    const nextInFlight = scopedScheduledRunner!(orchestrator, now)
      .then(async (lines) => {
        await runtime.recordServicePollerOutcome({
          poller,
          status: "ok",
          startedAt,
          finishedAt: new Date().toISOString(),
          lines,
        });
      })
      .catch(async (error) => {
        await runtime.recordServicePollerOutcome({
          poller,
          status: "failed",
          startedAt,
          finishedAt: new Date().toISOString(),
          error,
        });
      })
      .finally(() => {
        if (orchestrator === "sync") {
          scheduledSyncInFlight = null;
          return;
        }
        scheduledDeliveryInFlight = null;
      });
    if (orchestrator === "sync") {
      scheduledSyncInFlight = nextInFlight;
    } else {
      scheduledDeliveryInFlight = nextInFlight;
    }
    return nextInFlight;
  };

  const runAnalysis = () => {
    if (analysisInFlight) {
      return analysisInFlight;
    }
    const startedAt = new Date().toISOString();
    analysisInFlight = runtime
      .runPendingAnalysisJobs(new Date())
      .then(async (lines) => {
        await runtime.recordServicePollerOutcome({
          poller: "analysis",
          status: "ok",
          startedAt,
          finishedAt: new Date().toISOString(),
          lines,
        });
      })
      .catch(async (error) => {
        await runtime.recordServicePollerOutcome({
          poller: "analysis",
          status: "failed",
          startedAt,
          finishedAt: new Date().toISOString(),
          error,
        });
      })
      .finally(() => {
        analysisInFlight = null;
      });
    return analysisInFlight;
  };

  return {
    id: "hetang-ops-scheduler",
    start: async () => {
      stopped = false;
      if (enableScheduled) {
        if (scopedScheduledRunner) {
          void runScheduledScoped("sync");
          void runScheduledScoped("delivery");
        } else {
          void runScheduled();
        }
      }
      if (enableAnalysis) {
        void runAnalysis();
      }
      if (stopped) {
        return;
      }
      if (enableScheduled) {
        if (scopedScheduledRunner) {
          scheduledSyncTimer = setInterval(() => {
            void runScheduledScoped("sync");
          }, schedulePollIntervalMs);
          scheduledDeliveryTimer = setInterval(() => {
            void runScheduledScoped("delivery");
          }, schedulePollIntervalMs);
          if (unrefTimers) {
            scheduledSyncTimer.unref?.();
            scheduledDeliveryTimer.unref?.();
          }
        } else {
          scheduledTimer = setInterval(() => {
            void runScheduled();
          }, schedulePollIntervalMs);
          if (unrefTimers) {
            scheduledTimer.unref?.();
          }
        }
      }
      if (enableAnalysis) {
        analysisTimer = setInterval(() => {
          void runAnalysis();
        }, analysisPollIntervalMs);
        if (unrefTimers) {
          analysisTimer.unref?.();
        }
      }
    },
    stop: async () => {
      stopped = true;
      if (scheduledTimer) {
        clearInterval(scheduledTimer);
        scheduledTimer = null;
      }
      if (scheduledSyncTimer) {
        clearInterval(scheduledSyncTimer);
        scheduledSyncTimer = null;
      }
      if (scheduledDeliveryTimer) {
        clearInterval(scheduledDeliveryTimer);
        scheduledDeliveryTimer = null;
      }
      if (analysisTimer) {
        clearInterval(analysisTimer);
        analysisTimer = null;
      }
      await Promise.all([
        scheduledInFlight?.catch(() => {}),
        scheduledSyncInFlight?.catch(() => {}),
        scheduledDeliveryInFlight?.catch(() => {}),
        analysisInFlight?.catch(() => {}),
      ]);
      await runtime.close();
    },
  };
}
