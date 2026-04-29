import { describe, expect, it, vi } from "vitest";
import { resolveHetangOpsConfig } from "../config.js";
import { HetangDeliveryService } from "./delivery-service.js";

function buildConfig() {
  return resolveHetangOpsConfig({
    api: {
      appKey: "demo-app-key",
      appSecret: "demo-app-secret",
    },
    database: {
      url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
    },
    stores: [{ orgId: "1001", storeName: "迎宾店", isActive: true }],
  });
}

describe("HetangDeliveryService", () => {
  it("owns midday brief delivery state and prevents duplicate sends across repeated runs", async () => {
    const scheduledStates = new Map<string, Record<string, unknown>>();
    const store = {
      tryAdvisoryLock: vi.fn().mockResolvedValue(true),
      releaseAdvisoryLock: vi.fn().mockResolvedValue(undefined),
      getScheduledJobState: vi.fn(async (_jobType: string, runKey: string) => scheduledStates.get(runKey) ?? null),
      setScheduledJobState: vi.fn(
        async (_jobType: string, runKey: string, state: Record<string, unknown>) => {
          scheduledStates.set(runKey, state);
        },
      ),
    };
    const sendMiddayBrief = vi.fn(async () => "迎宾店: midday brief sent");
    const service = new HetangDeliveryService({
      config: buildConfig(),
      logger: { info() {}, warn() {}, error() {} },
      getStore: async () => store as never,
      sendMiddayBrief,
      sendReactivationPush: vi.fn(),
    });

    const first = await service.sendAllMiddayBriefs({ bizDate: "2026-04-12" });
    const second = await service.sendAllMiddayBriefs({ bizDate: "2026-04-12" });

    expect(first.allSent).toBe(true);
    expect(second.allSent).toBe(true);
    expect(sendMiddayBrief).toHaveBeenCalledTimes(1);
    expect(second.lines).toEqual(["迎宾店: midday brief already sent"]);
  });

  it("owns reactivation push delivery state and prevents duplicate sends across repeated runs", async () => {
    const scheduledStates = new Map<string, Record<string, unknown>>();
    const store = {
      tryAdvisoryLock: vi.fn().mockResolvedValue(true),
      releaseAdvisoryLock: vi.fn().mockResolvedValue(undefined),
      getScheduledJobState: vi.fn(async (_jobType: string, runKey: string) => scheduledStates.get(runKey) ?? null),
      setScheduledJobState: vi.fn(
        async (_jobType: string, runKey: string, state: Record<string, unknown>) => {
          scheduledStates.set(runKey, state);
        },
      ),
    };
    const sendReactivationPush = vi.fn(async () => "迎宾店: reactivation push sent");
    const service = new HetangDeliveryService({
      config: buildConfig(),
      logger: { info() {}, warn() {}, error() {} },
      getStore: async () => store as never,
      sendMiddayBrief: vi.fn(),
      sendReactivationPush,
    });

    const first = await service.sendAllReactivationPushes({ bizDate: "2026-04-12" });
    const second = await service.sendAllReactivationPushes({ bizDate: "2026-04-12" });

    expect(first.allSent).toBe(true);
    expect(second.allSent).toBe(true);
    expect(sendReactivationPush).toHaveBeenCalledTimes(1);
    expect(second.lines).toEqual(["迎宾店: reactivation push already sent"]);
  });
});
