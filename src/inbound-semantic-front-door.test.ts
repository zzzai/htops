import { describe, expect, it, vi } from "vitest";
import { resolveHetangOpsConfig } from "./config.js";
import {
  executeSemanticFrontDoorAction,
  resolveSemanticEarlyStopGate,
} from "./inbound.js";
import type { HetangSemanticIntent } from "./semantic-intent.js";

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
        storeName: "迎宾店",
        rawAliases: ["迎宾"],
      },
      {
        orgId: "1002",
        storeName: "义乌店",
        rawAliases: ["义乌"],
      },
    ],
    sync: { enabled: false },
    reporting: { enabled: false },
  });
}

function buildLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function buildRuntime() {
  return {
    enqueueAnalysisJob: vi.fn().mockResolvedValue({
      jobId: "JOB-1",
      status: "pending",
      queueDisposition: "created",
      storeName: "两店",
    }),
  };
}

function buildIntent(
  overrides: Partial<HetangSemanticIntent>,
): HetangSemanticIntent {
  return {
    lane: "meta",
    kind: "concept_explain",
    confidence: "high",
    scope: {
      orgIds: [],
      allStores: false,
    },
    object: "concept",
    action: "explain",
    clarificationNeeded: false,
    reason: "test",
    ...overrides,
  };
}

describe("executeSemanticFrontDoorAction", () => {
  it("exposes the semantic early-stop gate as an explicit meta-only decision point", async () => {
    const gateAction = await resolveSemanticEarlyStopGate({
      config: buildConfig(),
      runtime: buildRuntime() as never,
      logger: buildLogger(),
      text: "什么是复盘，如何复盘？",
      intent: buildIntent({}),
      binding: null,
      channel: "wecom",
      senderId: "user-1",
      now: new Date("2026-04-14T10:00:00+08:00"),
    });

    expect(gateAction.decision).toBe("semantic_meta_early_stop");
    expect(gateAction.probeOutcome).toBe("none");
    expect(gateAction.text).toContain("复盘");
  });

  it("lets query asks pass through the semantic early-stop gate", async () => {
    const gateAction = await resolveSemanticEarlyStopGate({
      config: buildConfig(),
      runtime: buildRuntime() as never,
      logger: buildLogger(),
      text: "昨天营收多少",
      intent: buildIntent({
        lane: "query",
        kind: "query",
        object: "store",
        action: "summary",
      }),
      binding: null,
      channel: "wecom",
      senderId: "user-1",
      now: new Date("2026-04-14T10:00:00+08:00"),
    });

    expect(gateAction).toEqual({
      decision: "continue",
      text: undefined,
      probeOutcome: null,
    });
  });

  it("returns an explicit semantic meta early-stop action", async () => {
    const action = await executeSemanticFrontDoorAction({
      config: buildConfig(),
      runtime: buildRuntime() as never,
      logger: buildLogger(),
      text: "什么是复盘，如何复盘？",
      intent: buildIntent({}),
      binding: null,
      channel: "wecom",
      senderId: "user-1",
      notification: {
        channel: "wecom",
        target: "room-1",
      },
      now: new Date("2026-04-14T10:00:00+08:00"),
    });

    expect(action.decision).toBe("semantic_meta_early_stop");
    expect(action.probeOutcome).toBe("none");
    expect(action.text).toContain("复盘");
  });

  it("runs typed semantic query execution directly", async () => {
    const queryRunner = vi.fn().mockResolvedValue("迎宾店昨天服务营收 3200 元。");

    const action = await executeSemanticFrontDoorAction({
      config: buildConfig(),
      runtime: buildRuntime() as never,
      logger: buildLogger(),
      text: "昨天营收多少",
      intent: buildIntent({
        lane: "query",
        kind: "query",
        object: "store",
        action: "summary",
      }),
      binding: null,
      channel: "wecom",
      senderId: "user-1",
      notification: {
        channel: "wecom",
        target: "room-1",
      },
      now: new Date("2026-04-14T10:00:00+08:00"),
      queryRunner: queryRunner as never,
    });

    expect(action).toMatchObject({
      decision: "semantic_query_direct",
      text: "迎宾店昨天服务营收 3200 元。",
      probeOutcome: null,
    });
    expect(queryRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        queryText: "昨天营收多少",
        channel: "wecom",
        senderId: "user-1",
      }),
    );
  });

  it("queues semantic analysis directly from semanticIntent.analysisRequest", async () => {
    const runtime = buildRuntime();

    const action = await executeSemanticFrontDoorAction({
      config: buildConfig(),
      runtime: runtime as never,
      logger: buildLogger(),
      text: "五店近30天经营复盘，给指导意见",
      intent: buildIntent({
        lane: "analysis",
        kind: "analysis",
        object: "store",
        action: "analysis",
        capabilityId: "store_review_async_v1",
        analysisRequest: {
          jobType: "store_review",
          orgId: "__binding_scope__",
          storeName: "五店",
          rawText: "五店近30天经营复盘，给指导意见",
          timeFrameLabel: "近30天",
          startBizDate: "2026-03-15",
          endBizDate: "2026-04-13",
        },
      }),
      binding: {
        channel: "wecom",
        senderId: "user-hq",
        employeeName: "运营总",
        role: "hq",
        scopeOrgIds: ["1001", "1002"],
        isActive: true,
      },
      channel: "wecom",
      senderId: "user-hq",
      notification: {
        channel: "wecom",
        target: "room-hq",
        accountId: "acct-1",
        threadId: "thread-1",
      },
      now: new Date("2026-04-14T10:00:00+08:00"),
    });

    expect(action.decision).toBe("semantic_analysis_direct");
    expect(action.probeOutcome).toBe(null);
    expect(action.text).toContain("已收到");
    expect(runtime.enqueueAnalysisJob).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilityId: "store_review_async_v1",
        orgId: "scope:1001,1002",
        rawText: "五店近30天经营复盘，给指导意见",
        notification: expect.objectContaining({
          target: "room-hq",
          accountId: "acct-1",
          threadId: "thread-1",
        }),
        senderId: "user-hq",
      }),
    );
  });
});
