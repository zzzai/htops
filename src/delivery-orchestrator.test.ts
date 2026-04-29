import { describe, expect, it, vi } from "vitest";
import { HetangDeliveryOrchestrator } from "./delivery-orchestrator.js";
import { resolveHetangOpsConfig } from "./config.js";

type DeliveryState = {
  deliveredAtByOrgId: Record<string, string>;
  updatedAt: string;
};

function buildConfig() {
  return resolveHetangOpsConfig({
    api: {
      appKey: "demo-app-key",
      appSecret: "demo-app-secret",
    },
    database: {
      url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
    },
    stores: [{ orgId: "1001", storeName: "一号店", isActive: true }],
  });
}

function cloneState(state: DeliveryState): DeliveryState {
  return {
    deliveredAtByOrgId: { ...state.deliveredAtByOrgId },
    updatedAt: state.updatedAt,
  };
}

describe("HetangDeliveryOrchestrator", () => {
  it("serializes overlapping midday sends per store so they do not double-send", async () => {
    const config = buildConfig();
    const states = new Map<string, DeliveryState>();
    const heldLocks = new Set<number>();
    let releaseSend!: () => void;
    const sendGate = new Promise<void>((resolve) => {
      releaseSend = resolve;
    });
    const store = {
      tryAdvisoryLock: vi.fn(async (lockKey: number) => {
        if (heldLocks.has(lockKey)) {
          return false;
        }
        heldLocks.add(lockKey);
        return true;
      }),
      releaseAdvisoryLock: vi.fn(async (lockKey: number) => {
        heldLocks.delete(lockKey);
      }),
    };
    const sendMiddayBrief = vi.fn(async () => {
      await sendGate;
      return "一号店: midday brief sent";
    });
    const orchestrator = new HetangDeliveryOrchestrator({
      config,
      logger: { info() {}, warn() {}, error() {} },
      getStore: async () => store as never,
      sendMiddayBrief,
      sendReactivationPush: vi.fn(),
      getMiddayBriefDeliveryState: async (_store, runKey) =>
        cloneState(
          states.get(runKey) ?? {
            deliveredAtByOrgId: {},
            updatedAt: "2026-04-07T04:00:00.000Z",
          },
        ),
      persistMiddayBriefDeliveryState: async (_store, runKey, state) => {
        states.set(runKey, cloneState(state));
      },
      getReactivationPushDeliveryState: vi.fn(),
      persistReactivationPushDeliveryState: vi.fn(),
    });

    const first = orchestrator.sendAllMiddayBriefs({ bizDate: "2026-04-06" });
    await Promise.resolve();
    const second = orchestrator.sendAllMiddayBriefs({ bizDate: "2026-04-06" });
    await Promise.resolve();
    releaseSend();
    await Promise.all([first, second]);

    expect(sendMiddayBrief).toHaveBeenCalledTimes(1);
    expect(states.get("2026-04-06")?.deliveredAtByOrgId["1001"]).toBeTruthy();
  });

  it("serializes overlapping reactivation pushes per store so they do not double-send", async () => {
    const config = buildConfig();
    const states = new Map<string, DeliveryState>();
    const heldLocks = new Set<number>();
    let releaseSend!: () => void;
    const sendGate = new Promise<void>((resolve) => {
      releaseSend = resolve;
    });
    const store = {
      tryAdvisoryLock: vi.fn(async (lockKey: number) => {
        if (heldLocks.has(lockKey)) {
          return false;
        }
        heldLocks.add(lockKey);
        return true;
      }),
      releaseAdvisoryLock: vi.fn(async (lockKey: number) => {
        heldLocks.delete(lockKey);
      }),
    };
    const sendReactivationPush = vi.fn(async () => {
      await sendGate;
      return "一号店: reactivation push sent";
    });
    const orchestrator = new HetangDeliveryOrchestrator({
      config,
      logger: { info() {}, warn() {}, error() {} },
      getStore: async () => store as never,
      sendMiddayBrief: vi.fn(),
      sendReactivationPush,
      getMiddayBriefDeliveryState: vi.fn(),
      persistMiddayBriefDeliveryState: vi.fn(),
      getReactivationPushDeliveryState: async (_store, runKey) =>
        cloneState(
          states.get(runKey) ?? {
            deliveredAtByOrgId: {},
            updatedAt: "2026-04-07T04:00:00.000Z",
          },
        ),
      persistReactivationPushDeliveryState: async (_store, runKey, state) => {
        states.set(runKey, cloneState(state));
      },
    });

    const first = orchestrator.sendAllReactivationPushes({ bizDate: "2026-04-06" });
    await Promise.resolve();
    const second = orchestrator.sendAllReactivationPushes({ bizDate: "2026-04-06" });
    await Promise.resolve();
    releaseSend();
    await Promise.all([first, second]);

    expect(sendReactivationPush).toHaveBeenCalledTimes(1);
    expect(states.get("2026-04-06")?.deliveredAtByOrgId["1001"]).toBeTruthy();
  });
});
