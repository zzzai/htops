import { afterEach, describe, expect, it, vi } from "vitest";
import { createHetangOpsService } from "./service.js";

describe("createHetangOpsService", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not start a second polling run while the previous run is still in flight", async () => {
    vi.useFakeTimers();

    let resolveRun: (() => void) | null = null;
    const runDueJobs = vi.fn().mockImplementation(
      () =>
        new Promise<string[]>((resolve) => {
          resolveRun = () => resolve([]);
        }),
    );
    const runPendingAnalysisJobs = vi.fn().mockResolvedValue([]);
    const recordServicePollerOutcome = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const service = createHetangOpsService({
      runDueJobs,
      runPendingAnalysisJobs,
      recordServicePollerOutcome,
      close,
    } as never);

    const startPromise = service.start?.();
    await vi.runAllTicks();

    expect(runDueJobs).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(runDueJobs).toHaveBeenCalledTimes(1);

    const finishRun: () => void = resolveRun ?? (() => undefined);
    finishRun();
    await startPromise;

    await vi.advanceTimersByTimeAsync(60_000);
    expect(runDueJobs).toHaveBeenCalledTimes(2);

    const finishRunAgain: () => void = resolveRun ?? (() => undefined);
    finishRunAgain();
    await service.stop?.();
  });

  it("waits for the in-flight polling run to finish before closing the runtime", async () => {
    vi.useFakeTimers();

    let resolveRun: (() => void) | null = null;
    const runDueJobs = vi.fn().mockImplementation(
      () =>
        new Promise<string[]>((resolve) => {
          resolveRun = () => resolve([]);
        }),
    );
    const runPendingAnalysisJobs = vi.fn().mockResolvedValue([]);
    const recordServicePollerOutcome = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const service = createHetangOpsService({
      runDueJobs,
      runPendingAnalysisJobs,
      recordServicePollerOutcome,
      close,
    } as never);

    const startPromise = service.start?.();
    await vi.runAllTicks();
    expect(runDueJobs).toHaveBeenCalledTimes(1);

    const stopPromise = service.stop?.();
    await vi.runAllTicks();
    expect(close).not.toHaveBeenCalled();

    const finishRun: () => void = resolveRun ?? (() => undefined);
    finishRun();
    await startPromise;
    await stopPromise;

    expect(close).toHaveBeenCalledTimes(1);
  });

  it("polls pending deep-analysis jobs in the same scheduler loop", async () => {
    const runDueJobs = vi.fn().mockResolvedValue([]);
    const runPendingAnalysisJobs = vi.fn().mockResolvedValue([]);
    const recordServicePollerOutcome = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const service = createHetangOpsService({
      runDueJobs,
      runPendingAnalysisJobs,
      recordServicePollerOutcome,
      close,
    } as never);

    await service.start?.();
    await service.stop?.();

    expect(runDueJobs).toHaveBeenCalledTimes(1);
    expect(runPendingAnalysisJobs).toHaveBeenCalledTimes(1);
  });

  it("keeps the analysis poller moving even when scheduled jobs are still in flight", async () => {
    vi.useFakeTimers();

    let resolveDueJobs: (() => void) | null = null;
    const runDueJobs = vi.fn().mockImplementation(
      () =>
        new Promise<string[]>((resolve) => {
          resolveDueJobs = () => resolve([]);
        }),
    );
    const runPendingAnalysisJobs = vi.fn().mockResolvedValue([]);
    const recordServicePollerOutcome = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const service = createHetangOpsService({
      runDueJobs,
      runPendingAnalysisJobs,
      recordServicePollerOutcome,
      close,
    } as never);

    const startPromise = service.start?.();
    await vi.runAllTicks();

    expect(runDueJobs).toHaveBeenCalledTimes(1);
    expect(runPendingAnalysisJobs).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(runPendingAnalysisJobs).toHaveBeenCalledTimes(2);
    expect(runDueJobs).toHaveBeenCalledTimes(1);

    const finishDueJobs: () => void = resolveDueJobs ?? (() => undefined);
    finishDueJobs();
    await startPromise;
    await service.stop?.();
  });

  it("keeps the delivery lane moving even when the sync lane is still in flight", async () => {
    vi.useFakeTimers();

    let resolveSyncLane: (() => void) | null = null;
    const runDueJobs = vi.fn().mockResolvedValue([]);
    const runDueJobsByOrchestrator = vi.fn().mockImplementation(
      (orchestrator: "sync" | "delivery") =>
        orchestrator === "sync"
          ? new Promise<string[]>((resolve) => {
              resolveSyncLane = () => resolve([]);
            })
          : Promise.resolve([]),
    );
    const runPendingAnalysisJobs = vi.fn().mockResolvedValue([]);
    const recordServicePollerOutcome = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const service = createHetangOpsService({
      runDueJobs,
      runDueJobsByOrchestrator,
      runPendingAnalysisJobs,
      recordServicePollerOutcome,
      close,
    } as never);

    const startPromise = service.start?.();
    await vi.runAllTicks();

    expect(runDueJobsByOrchestrator).toHaveBeenCalledWith("sync", expect.any(Date));
    expect(runDueJobsByOrchestrator).toHaveBeenCalledWith("delivery", expect.any(Date));
    expect(runDueJobsByOrchestrator).toHaveBeenCalledTimes(2);
    expect(runDueJobs).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(
      runDueJobsByOrchestrator.mock.calls.filter((call) => call[0] === "sync"),
    ).toHaveLength(1);
    expect(
      runDueJobsByOrchestrator.mock.calls.filter((call) => call[0] === "delivery"),
    ).toHaveLength(2);

    const finishSyncLane: () => void = resolveSyncLane ?? (() => undefined);
    finishSyncLane();
    await startPromise;
    await service.stop?.();
  });

  it("records split scheduled poller failures instead of swallowing them silently", async () => {
    const syncError = new Error("scheduled sync boom");
    const deliveryError = new Error("scheduled delivery boom");
    const analysisError = new Error("analysis boom");
    const runDueJobs = vi.fn().mockResolvedValue([]);
    const runDueJobsByOrchestrator = vi.fn().mockImplementation(
      (orchestrator: "sync" | "delivery") =>
        orchestrator === "sync" ? Promise.reject(syncError) : Promise.reject(deliveryError),
    );
    const runPendingAnalysisJobs = vi.fn().mockRejectedValue(analysisError);
    const recordServicePollerOutcome = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const service = createHetangOpsService({
      runDueJobs,
      runDueJobsByOrchestrator,
      runPendingAnalysisJobs,
      recordServicePollerOutcome,
      close,
    } as never);

    await service.start?.();
    await service.stop?.();

    expect(recordServicePollerOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        poller: "scheduled-sync",
        status: "failed",
        error: syncError,
      }),
    );
    expect(recordServicePollerOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        poller: "scheduled-delivery",
        status: "failed",
        error: deliveryError,
      }),
    );
    expect(recordServicePollerOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        poller: "analysis",
        status: "failed",
        error: analysisError,
      }),
    );
  });

  it("records split scheduled poller outcomes separately when lane polling is enabled", async () => {
    const runDueJobs = vi.fn().mockResolvedValue([]);
    const runDueJobsByOrchestrator = vi.fn().mockImplementation(
      (orchestrator: "sync" | "delivery") => Promise.resolve([`${orchestrator} ok`]),
    );
    const runPendingAnalysisJobs = vi.fn().mockResolvedValue([]);
    const recordServicePollerOutcome = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const service = createHetangOpsService({
      runDueJobs,
      runDueJobsByOrchestrator,
      runPendingAnalysisJobs,
      recordServicePollerOutcome,
      close,
    } as never);

    await service.start?.();
    await service.stop?.();

    expect(recordServicePollerOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        poller: "scheduled-sync",
        status: "ok",
        lines: ["sync ok"],
      }),
    );
    expect(recordServicePollerOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        poller: "scheduled-delivery",
        status: "ok",
        lines: ["delivery ok"],
      }),
    );
  });

  it("runs only the analysis poller in analysis-only worker mode", async () => {
    const runDueJobs = vi.fn().mockResolvedValue([]);
    const runPendingAnalysisJobs = vi.fn().mockResolvedValue([]);
    const recordServicePollerOutcome = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const service = createHetangOpsService(
      {
        runDueJobs,
        runPendingAnalysisJobs,
        recordServicePollerOutcome,
        close,
      } as never,
      {
        mode: "analysis",
      },
    );

    await service.start?.();
    await service.stop?.();

    expect(runDueJobs).not.toHaveBeenCalled();
    expect(runPendingAnalysisJobs).toHaveBeenCalledTimes(1);
  });

  it("runs only the scheduled poller in scheduled-only worker mode", async () => {
    const runDueJobs = vi.fn().mockResolvedValue([]);
    const runPendingAnalysisJobs = vi.fn().mockResolvedValue([]);
    const recordServicePollerOutcome = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const service = createHetangOpsService(
      {
        runDueJobs,
        runPendingAnalysisJobs,
        recordServicePollerOutcome,
        close,
      } as never,
      {
        mode: "scheduled",
      },
    );

    await service.start?.();
    await service.stop?.();

    expect(runDueJobs).toHaveBeenCalledTimes(1);
    expect(runPendingAnalysisJobs).not.toHaveBeenCalled();
  });
});
