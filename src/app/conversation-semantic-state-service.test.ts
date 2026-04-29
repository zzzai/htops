import { describe, expect, it, vi } from "vitest";
import { resolveHetangOpsConfig } from "../config.js";
import { resolveSemanticIntent } from "../semantic-intent.js";
import {
  HetangConversationSemanticStateService,
  buildConversationSemanticSessionId,
} from "./conversation-semantic-state-service.js";
import type { HetangConversationSemanticStateSnapshot } from "../types.js";

function buildConfig() {
  return resolveHetangOpsConfig({
    api: {
      appKey: "demo-app-key",
      appSecret: "demo-app-secret",
    },
    database: {
      url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
    },
    stores: [
      {
        orgId: "1001",
        storeName: "义乌店",
        rawAliases: ["义乌"],
        notification: { channel: "wecom", target: "room-yiwu" },
      },
      {
        orgId: "1002",
        storeName: "迎宾店",
        rawAliases: ["迎宾"],
        notification: { channel: "wecom", target: "room-yingbin" },
      },
    ],
    sync: { enabled: false },
    reporting: { enabled: false },
  });
}

function buildSnapshot(
  overrides: Partial<HetangConversationSemanticStateSnapshot> = {},
): HetangConversationSemanticStateSnapshot {
  return {
    sessionId: "wecom:conv-1",
    channel: "wecom",
    senderId: "user-1",
    conversationId: "conv-1",
    clarificationPending: true,
    clarificationReason: "missing-time",
    anchoredSlots: {},
    missingSlots: ["time"],
    beliefState: {
      pendingText: "义乌店营收怎么样",
    },
    desireState: {},
    intentionState: {},
    updatedAt: "2026-04-17T09:00:00.000Z",
    expiresAt: "2026-04-17T10:00:00.000Z",
    ...overrides,
  };
}

describe("HetangConversationSemanticStateService", () => {
  const config = buildConfig();
  const now = new Date("2026-04-17T09:30:00.000Z");

  it("inherits a pending clarify state when the next turn only supplies the missing time range", async () => {
    const store = {
      getConversationSemanticState: vi.fn().mockResolvedValue(buildSnapshot()),
      upsertConversationSemanticState: vi.fn(),
      appendConversationAnchorFacts: vi.fn(),
      deleteExpiredConversationSemanticState: vi.fn(),
    };
    const service = new HetangConversationSemanticStateService({
      store: store as never,
    });

    const resolved = await service.resolveTurnState({
      config,
      channel: "wecom",
      senderId: "user-1",
      conversationId: "conv-1",
      text: "近7天",
      now,
    });

    expect(resolved.sessionId).toBe(buildConversationSemanticSessionId({
      channel: "wecom",
      senderId: "user-1",
      conversationId: "conv-1",
    }));
    expect(resolved.stateCarriedForward).toBe(true);
    expect(resolved.effectiveText).toBe("义乌店营收怎么样 近7天");
    expect(resolved.topicSwitchDetected).toBe(false);
  });

  it("inherits a pending clarify state when the next turn only supplies the missing store", async () => {
    const store = {
      getConversationSemanticState: vi.fn().mockResolvedValue(
        buildSnapshot({
          clarificationReason: "missing-store",
          missingSlots: ["store"],
          beliefState: {
            pendingText: "昨天营收怎么样",
          },
        }),
      ),
      upsertConversationSemanticState: vi.fn(),
      appendConversationAnchorFacts: vi.fn(),
      deleteExpiredConversationSemanticState: vi.fn(),
    };
    const service = new HetangConversationSemanticStateService({
      store: store as never,
    });

    const resolved = await service.resolveTurnState({
      config,
      channel: "wecom",
      senderId: "user-1",
      conversationId: "conv-1",
      text: "义乌店",
      now,
    });

    expect(resolved.stateCarriedForward).toBe(true);
    expect(resolved.effectiveText).toBe("昨天营收怎么样 义乌店");
    expect(resolved.topicSwitchDetected).toBe(false);
  });

  it("inherits a pending clarify state when the next turn only supplies the missing metric in boss-style wording", async () => {
    const store = {
      getConversationSemanticState: vi.fn().mockResolvedValue(
        buildSnapshot({
          clarificationReason: "missing-metric",
          missingSlots: ["metric"],
          beliefState: {
            pendingText: "义乌店近7天重点看什么",
          },
        }),
      ),
      upsertConversationSemanticState: vi.fn(),
      appendConversationAnchorFacts: vi.fn(),
      deleteExpiredConversationSemanticState: vi.fn(),
    };
    const service = new HetangConversationSemanticStateService({
      store: store as never,
    });

    const resolved = await service.resolveTurnState({
      config,
      channel: "wecom",
      senderId: "user-1",
      conversationId: "conv-1",
      text: "就看卡里还有多少",
      now,
    });

    expect(resolved.stateCarriedForward).toBe(true);
    expect(resolved.effectiveText).toBe("义乌店近7天重点看什么 就看卡里还有多少");
    expect(resolved.topicSwitchDetected).toBe(false);
  });

  it("resets the pending clarify carry-over when the next turn is clearly a topic switch", async () => {
    const store = {
      getConversationSemanticState: vi.fn().mockResolvedValue(buildSnapshot()),
      upsertConversationSemanticState: vi.fn(),
      appendConversationAnchorFacts: vi.fn(),
      deleteExpiredConversationSemanticState: vi.fn(),
    };
    const service = new HetangConversationSemanticStateService({
      store: store as never,
    });

    const resolved = await service.resolveTurnState({
      config,
      channel: "wecom",
      senderId: "user-1",
      conversationId: "conv-1",
      text: "迎宾店近30天顾客画像",
      now,
    });

    expect(resolved.stateCarriedForward).toBe(false);
    expect(resolved.topicSwitchDetected).toBe(true);
    expect(resolved.effectiveText).toBe("迎宾店近30天顾客画像");
  });

  it("treats an HQ risk ask as a topic switch instead of carrying a missing-metric clarification forward", async () => {
    const store = {
      getConversationSemanticState: vi.fn().mockResolvedValue(
        buildSnapshot({
          clarificationReason: "missing-metric",
          missingSlots: ["metric"],
          beliefState: {
            pendingText: "义乌店近7天重点看什么",
          },
        }),
      ),
      upsertConversationSemanticState: vi.fn(),
      appendConversationAnchorFacts: vi.fn(),
      deleteExpiredConversationSemanticState: vi.fn(),
    };
    const service = new HetangConversationSemanticStateService({
      store: store as never,
    });

    const resolved = await service.resolveTurnState({
      config,
      channel: "wecom",
      senderId: "user-1",
      conversationId: "conv-1",
      text: "哪个门店须重点关注",
      now,
    });

    expect(resolved.stateCarriedForward).toBe(false);
    expect(resolved.topicSwitchDetected).toBe(true);
    expect(resolved.effectiveText).toBe("哪个门店须重点关注");
  });

  it("records richer anchored semantic state after a successful turn completes", async () => {
    const store = {
      getConversationSemanticState: vi.fn().mockResolvedValue(null),
      upsertConversationSemanticState: vi.fn().mockResolvedValue(undefined),
      appendConversationAnchorFacts: vi.fn().mockResolvedValue(undefined),
      deleteExpiredConversationSemanticState: vi.fn().mockResolvedValue(undefined),
    };
    const service = new HetangConversationSemanticStateService({
      store: store as never,
    });
    const semanticIntent = resolveSemanticIntent({
      config,
      text: "义乌店近7天营收多少",
      now,
    });

    await service.recordTurnResult({
      sessionId: "wecom:conv-1",
      channel: "wecom",
      senderId: "user-1",
      conversationId: "conv-1",
      rawText: "义乌店近7天营收多少",
      effectiveText: "义乌店近7天营收多少",
      semanticIntent,
      now,
    });

    expect(store.upsertConversationSemanticState).toHaveBeenCalledWith(
      expect.objectContaining({
        clarificationPending: false,
        anchoredSlots: expect.objectContaining({
          lastCapabilityId: "store_window_summary_v1",
          lastObject: "store",
          lastMetricKeys: ["serviceRevenue"],
          lastFailureClass: undefined,
        }),
      }),
    );
  });

  it("records semantic state without requiring deprecated anchor-fact writes", async () => {
    const store = {
      getConversationSemanticState: vi.fn().mockResolvedValue(null),
      upsertConversationSemanticState: vi.fn().mockResolvedValue(undefined),
      deleteExpiredConversationSemanticState: vi.fn().mockResolvedValue(undefined),
    };
    const service = new HetangConversationSemanticStateService({
      store: store as never,
    });
    const semanticIntent = resolveSemanticIntent({
      config,
      text: "义乌店近7天营收多少",
      now,
    });

    await expect(
      service.recordTurnResult({
        sessionId: "wecom:conv-2",
        channel: "wecom",
        senderId: "user-2",
        conversationId: "conv-2",
        rawText: "义乌店近7天营收多少",
        effectiveText: "义乌店近7天营收多少",
        semanticIntent,
        now,
      }),
    ).resolves.toBeUndefined();

    expect(store.upsertConversationSemanticState).toHaveBeenCalledTimes(1);
  });

  it("inherits scope via object-switch continuation when previous turn was a successful query", async () => {
    const store = {
      getConversationSemanticState: vi.fn().mockResolvedValue(
        buildSnapshot({
          clarificationPending: false,
          clarificationReason: undefined,
          missingSlots: [],
          beliefState: {
            lastEffectiveText: "义乌店近7天营收多少",
          },
          lastIntentKind: "query",
        }),
      ),
      upsertConversationSemanticState: vi.fn(),
      appendConversationAnchorFacts: vi.fn(),
      deleteExpiredConversationSemanticState: vi.fn(),
    };
    const service = new HetangConversationSemanticStateService({
      store: store as never,
    });

    const resolved = await service.resolveTurnState({
      config,
      channel: "wecom",
      senderId: "user-1",
      conversationId: "conv-1",
      text: "那顾客呢",
      now,
    });

    expect(resolved.stateCarriedForward).toBe(true);
    expect(resolved.effectiveText).toContain("义乌店");
    expect(resolved.effectiveText).toContain("顾客");
    expect(resolved.topicSwitchDetected).toBe(false);
  });

  it("inherits scope via object-switch continuation for tech object switch", async () => {
    const store = {
      getConversationSemanticState: vi.fn().mockResolvedValue(
        buildSnapshot({
          clarificationPending: false,
          clarificationReason: undefined,
          missingSlots: [],
          beliefState: {
            lastEffectiveText: "义乌店近7天营收多少",
          },
          lastIntentKind: "query",
        }),
      ),
      upsertConversationSemanticState: vi.fn(),
      appendConversationAnchorFacts: vi.fn(),
      deleteExpiredConversationSemanticState: vi.fn(),
    };
    const service = new HetangConversationSemanticStateService({
      store: store as never,
    });

    const resolved = await service.resolveTurnState({
      config,
      channel: "wecom",
      senderId: "user-1",
      conversationId: "conv-1",
      text: "技师呢",
      now,
    });

    expect(resolved.stateCarriedForward).toBe(true);
    expect(resolved.effectiveText).toContain("义乌店");
    expect(resolved.effectiveText).toContain("技师");
    expect(resolved.topicSwitchDetected).toBe(false);
  });

  it("inherits scope via object-switch continuation for risk follow-up", async () => {
    const store = {
      getConversationSemanticState: vi.fn().mockResolvedValue(
        buildSnapshot({
          clarificationPending: false,
          clarificationReason: undefined,
          missingSlots: [],
          beliefState: {
            lastEffectiveText: "义乌店近7天营收多少",
          },
          lastIntentKind: "query",
        }),
      ),
      upsertConversationSemanticState: vi.fn(),
      appendConversationAnchorFacts: vi.fn(),
      deleteExpiredConversationSemanticState: vi.fn(),
    };
    const service = new HetangConversationSemanticStateService({
      store: store as never,
    });

    const resolved = await service.resolveTurnState({
      config,
      channel: "wecom",
      senderId: "user-1",
      conversationId: "conv-1",
      text: "那风险呢",
      now,
    });

    expect(resolved.stateCarriedForward).toBe(true);
    expect(resolved.effectiveText).toContain("义乌店");
    expect(resolved.effectiveText).toContain("风险");
    expect(resolved.topicSwitchDetected).toBe(false);
  });

  it("inherits scope via object-switch continuation for advice follow-up", async () => {
    const store = {
      getConversationSemanticState: vi.fn().mockResolvedValue(
        buildSnapshot({
          clarificationPending: false,
          clarificationReason: undefined,
          missingSlots: [],
          beliefState: {
            lastEffectiveText: "义乌店近7天营收多少",
          },
          lastIntentKind: "query",
        }),
      ),
      upsertConversationSemanticState: vi.fn(),
      appendConversationAnchorFacts: vi.fn(),
      deleteExpiredConversationSemanticState: vi.fn(),
    };
    const service = new HetangConversationSemanticStateService({
      store: store as never,
    });

    const resolved = await service.resolveTurnState({
      config,
      channel: "wecom",
      senderId: "user-1",
      conversationId: "conv-1",
      text: "建议呢",
      now,
    });

    expect(resolved.stateCarriedForward).toBe(true);
    expect(resolved.effectiveText).toContain("义乌店");
    expect(resolved.effectiveText).toContain("建议");
    expect(resolved.topicSwitchDetected).toBe(false);
  });

  it("inherits scope via object-switch continuation for ranking follow-up", async () => {
    const store = {
      getConversationSemanticState: vi.fn().mockResolvedValue(
        buildSnapshot({
          clarificationPending: false,
          clarificationReason: undefined,
          missingSlots: [],
          beliefState: {
            lastEffectiveText: "义乌店近7天营收多少",
          },
          lastIntentKind: "query",
        }),
      ),
      upsertConversationSemanticState: vi.fn(),
      appendConversationAnchorFacts: vi.fn(),
      deleteExpiredConversationSemanticState: vi.fn(),
    };
    const service = new HetangConversationSemanticStateService({
      store: store as never,
    });

    const resolved = await service.resolveTurnState({
      config,
      channel: "wecom",
      senderId: "user-1",
      conversationId: "conv-1",
      text: "排行呢",
      now,
    });

    expect(resolved.stateCarriedForward).toBe(true);
    expect(resolved.effectiveText).toContain("义乌店");
    expect(resolved.effectiveText).toContain("排行");
    expect(resolved.topicSwitchDetected).toBe(false);
  });

  it("inherits scope via object-switch continuation for review follow-up", async () => {
    const store = {
      getConversationSemanticState: vi.fn().mockResolvedValue(
        buildSnapshot({
          clarificationPending: false,
          clarificationReason: undefined,
          missingSlots: [],
          beliefState: {
            lastEffectiveText: "义乌店近7天营收多少",
          },
          lastIntentKind: "query",
        }),
      ),
      upsertConversationSemanticState: vi.fn(),
      appendConversationAnchorFacts: vi.fn(),
      deleteExpiredConversationSemanticState: vi.fn(),
    };
    const service = new HetangConversationSemanticStateService({
      store: store as never,
    });

    const resolved = await service.resolveTurnState({
      config,
      channel: "wecom",
      senderId: "user-1",
      conversationId: "conv-1",
      text: "复盘呢",
      now,
    });

    expect(resolved.stateCarriedForward).toBe(true);
    expect(resolved.effectiveText).toContain("义乌店");
    expect(resolved.effectiveText).toContain("复盘");
    expect(resolved.topicSwitchDetected).toBe(false);
  });

  it("detects explicit topic switch phrases and resets state", async () => {
    const store = {
      getConversationSemanticState: vi.fn().mockResolvedValue(
        buildSnapshot({
          clarificationPending: false,
          clarificationReason: undefined,
          missingSlots: [],
          beliefState: {
            lastEffectiveText: "义乌店近7天营收多少",
          },
          lastIntentKind: "query",
        }),
      ),
      upsertConversationSemanticState: vi.fn(),
      appendConversationAnchorFacts: vi.fn(),
      deleteExpiredConversationSemanticState: vi.fn(),
    };
    const service = new HetangConversationSemanticStateService({
      store: store as never,
    });

    const resolved = await service.resolveTurnState({
      config,
      channel: "wecom",
      senderId: "user-1",
      conversationId: "conv-1",
      text: "换个话题，迎宾店近30天顾客画像",
      now,
    });

    expect(resolved.stateCarriedForward).toBe(false);
    expect(resolved.topicSwitchDetected).toBe(true);
    expect(resolved.effectiveText).toBe("换个话题，迎宾店近30天顾客画像");
  });

  it("persists lastEffectiveText in beliefState after a successful non-clarification turn", async () => {
    const store = {
      getConversationSemanticState: vi.fn().mockResolvedValue(null),
      upsertConversationSemanticState: vi.fn().mockResolvedValue(undefined),
      deleteExpiredConversationSemanticState: vi.fn().mockResolvedValue(undefined),
    };
    const service = new HetangConversationSemanticStateService({
      store: store as never,
    });
    const semanticIntent = resolveSemanticIntent({
      config,
      text: "义乌店近7天营收多少",
      now,
    });

    await service.recordTurnResult({
      sessionId: "wecom:conv-1",
      channel: "wecom",
      senderId: "user-1",
      conversationId: "conv-1",
      rawText: "义乌店近7天营收多少",
      effectiveText: "义乌店近7天营收多少",
      semanticIntent,
      now,
    });

    expect(store.upsertConversationSemanticState).toHaveBeenCalledWith(
      expect.objectContaining({
        beliefState: expect.objectContaining({
          lastEffectiveText: "义乌店近7天营收多少",
        }),
      }),
    );
  });
});
