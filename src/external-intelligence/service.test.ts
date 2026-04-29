import { afterEach, describe, expect, it, vi } from "vitest";
import { createHetangOpsService } from "../service.js";

describe("createHetangOpsService external intelligence safety", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("continues polling pending analysis jobs even when runDueJobs fails", async () => {
    const runDueJobs = vi.fn().mockRejectedValue(new Error("external intelligence failed"));
    const runPendingAnalysisJobs = vi.fn().mockResolvedValue([]);
    const close = vi.fn().mockResolvedValue(undefined);
    const service = createHetangOpsService({
      runDueJobs,
      runPendingAnalysisJobs,
      close,
    } as never);

    await service.start?.();
    await service.stop?.();

    expect(runDueJobs).toHaveBeenCalledTimes(1);
    expect(runPendingAnalysisJobs).toHaveBeenCalledTimes(1);
  });
});
