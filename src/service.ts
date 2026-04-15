import { HetangOpsRuntime } from "./runtime.js";
import type { HetangServiceWorkerMode } from "./types.js";

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

  let scheduledTimer: ReturnType<typeof setInterval> | null = null;
  let analysisTimer: ReturnType<typeof setInterval> | null = null;
  let scheduledInFlight: Promise<void> | null = null;
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
          poller: "scheduled",
          status: "ok",
          startedAt,
          finishedAt: new Date().toISOString(),
          lines,
        });
      })
      .catch(async (error) => {
        await runtime.recordServicePollerOutcome({
          poller: "scheduled",
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
        void runScheduled();
      }
      if (enableAnalysis) {
        void runAnalysis();
      }
      if (stopped) {
        return;
      }
      if (enableScheduled) {
        scheduledTimer = setInterval(() => {
          void runScheduled();
        }, schedulePollIntervalMs);
        if (unrefTimers) {
          scheduledTimer.unref?.();
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
      if (analysisTimer) {
        clearInterval(analysisTimer);
        analysisTimer = null;
      }
      await Promise.all([
        scheduledInFlight?.catch(() => {}),
        analysisInFlight?.catch(() => {}),
      ]);
      await runtime.close();
    },
  };
}
