import { describe, expect, it, vi } from "vitest";
import { resolveHetangOpsConfig } from "../config.js";
import type { HetangBridgeResponse } from "../bridge/contracts.js";
import { createHetangMessageEntryService } from "./message-entry-service.js";

function buildConfig(overrides: Record<string, unknown> = {}) {
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
        notification: { channel: "wecom", target: "room-yingbin" },
      },
    ],
    sync: { enabled: false },
    reporting: { enabled: false },
    ...overrides,
  });
}

function buildRuntime() {
  return {
    doctor: vi.fn().mockResolvedValue("doctor ok"),
    syncStores: vi.fn().mockResolvedValue(["sync ok"]),
    buildReport: vi.fn().mockResolvedValue({
      orgId: "1001",
      storeName: "迎宾店",
      bizDate: "2026-04-09",
      metrics: {},
      alerts: [],
      suggestions: [],
      markdown: "迎宾店日报",
      complete: true,
    }),
    getEmployeeBinding: vi.fn().mockResolvedValue(null),
    getCurrentServingVersion: vi.fn().mockResolvedValue("serving-test"),
    grantEmployeeBinding: vi.fn().mockResolvedValue(undefined),
    getCommandUsage: vi.fn().mockResolvedValue({ hourlyCount: 0, dailyCount: 0 }),
    resolveControlTowerSettings: vi.fn().mockResolvedValue({}),
    recordCommandAudit: vi.fn().mockResolvedValue(undefined),
    recordInboundMessageAudit: vi.fn().mockResolvedValue(undefined),
    listCurrentMembers: vi.fn().mockResolvedValue([]),
    listCustomerProfile90dByDateRange: vi.fn().mockResolvedValue([]),
    listTechUpClockByDateRange: vi.fn().mockResolvedValue([]),
    enqueueAnalysisJob: vi.fn().mockResolvedValue({
      jobId: "JOB-1",
      status: "pending",
      queueDisposition: "created",
      storeName: "迎宾店",
    }),
  };
}

function buildLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function extractRouteComparePayload(logger: ReturnType<typeof buildLogger>): Record<string, unknown> {
  const logLine = logger.info.mock.calls
    .flatMap((call) => call.filter((value): value is string => typeof value === "string"))
    .find((line) => line.includes("hetang-ops: route-compare "));
  const payload = logLine?.split("hetang-ops: route-compare ")[1];
  return payload ? (JSON.parse(payload) as Record<string, unknown>) : {};
}

describe("createHetangMessageEntryService", () => {
  it("describes bridge entries together with capability-graph introspection", () => {
    const service = createHetangMessageEntryService({
      config: buildConfig(),
      runtime: buildRuntime() as never,
      logger: buildLogger(),
    });

    expect(service.describeCapabilities()).toMatchObject({
      version: "v1",
      entries: ["command", "inbound"],
      query_graph_version: "capability-graph-v1",
      control_plane_contract_version: "2026-04-23.control-plane.v1",
      tool_contract_version: "2026-04-29.tools.v2",
      audit_surfaces: expect.arrayContaining([
        expect.objectContaining({
          entry: "command",
          sink: "command_audit_logs",
          persistence: "required",
        }),
        expect.objectContaining({
          entry: "inbound",
          sink: "inbound_message_audit_logs",
          persistence: "best_effort",
        }),
      ]),
      observability_streams: expect.arrayContaining([
        "route_compare_log",
        "command_audit_log",
        "inbound_audit_log",
      ]),
    });
    expect(service.describeCapabilities().serving_capability_count).toBeGreaterThan(0);
    expect(service.describeCapabilities().runtime_render_capability_count).toBeGreaterThan(0);
    expect(service.describeCapabilities().async_analysis_capability_count).toBeGreaterThan(0);
    expect(service.describeCapabilities().tool_count).toBeGreaterThan(0);
  });

  it("returns an immediate command reply for /hetang help traffic", async () => {
    const service = createHetangMessageEntryService({
      config: buildConfig(),
      runtime: buildRuntime() as never,
      logger: buildLogger(),
      now: () => new Date("2026-04-10T20:00:00+08:00"),
    });

    const response = await service.handleCommandMessage({
      request_id: "req-command-help",
      channel: "wecom",
      account_id: "acct-demo",
      sender_id: "user-1",
      sender_name: "张三",
      conversation_id: "conv-1",
      thread_id: "thread-1",
      is_group: true,
      was_mentioned: true,
      platform_message_id: "msg-1",
      content: "/hetang help",
      received_at: "2026-04-10T20:00:00+08:00",
      command_name: "hetang",
      args: "help",
      reply_target: "room-1",
    });

    expect(response).toMatchObject({
      ok: true,
      handled: true,
      reply: {
        mode: "immediate",
      },
      audit: {
        entry: "command",
      },
    });
    expect(response.reply?.text).toContain("Usage:");
  });

  it("returns noop for group inbound traffic when the bot was not mentioned", async () => {
    const runtime = buildRuntime();
    const service = createHetangMessageEntryService({
      config: buildConfig(),
      runtime: runtime as never,
      logger: buildLogger(),
    });

    const response = await service.handleInboundMessage({
      request_id: "req-inbound-noop",
      channel: "wecom",
      sender_id: "user-1",
      conversation_id: "conv-1",
      is_group: true,
      was_mentioned: false,
      content: "昨天营收多少",
      received_at: "2026-04-10T20:00:00+08:00",
    });

    expect(response).toEqual({
      ok: true,
      handled: false,
      reply: {
        mode: "noop",
      },
      job: null,
      audit: {
        entry: "inbound",
      },
    });
    expect(runtime.resolveControlTowerSettings).not.toHaveBeenCalled();
    expect(runtime.getEmployeeBinding).not.toHaveBeenCalled();
  });

  it("captures the immediate inbound reply instead of sending it through a gateway adapter", async () => {
    const service = createHetangMessageEntryService({
      config: buildConfig(),
      runtime: buildRuntime() as never,
      logger: buildLogger(),
    });

    const response = await service.handleInboundMessage({
      request_id: "req-inbound-identity",
      channel: "wecom",
      sender_id: "user-identity",
      conversation_id: "conv-identity",
      is_group: false,
      content: "你是谁",
      received_at: "2026-04-10T20:00:00+08:00",
    });

    expect(response).toMatchObject({
      ok: true,
      handled: true,
      reply: {
        mode: "immediate",
      },
      audit: {
        entry: "inbound",
      },
    });
    expect(response.reply?.text).toContain("荷塘AI小助手");
  });

  it("records the inbound payload with sender and conversation metadata before processing", async () => {
    const runtime = buildRuntime();
    const service = createHetangMessageEntryService({
      config: buildConfig(),
      runtime: runtime as never,
      logger: buildLogger(),
    });

    await service.handleInboundMessage({
      request_id: "req-inbound-audit",
      channel: "wecom",
      account_id: "acct-demo",
      sender_id: "wecom-user-42",
      sender_name: "李人培-安阳市区运营总",
      conversation_id: "chat-yiwu",
      thread_id: "thread-7",
      is_group: true,
      was_mentioned: true,
      platform_message_id: "msg-42",
      content: "@荷塘AI小助手1号 这几天义乌店的点钟率多少？加钟多少？",
      received_at: "2026-04-14T00:30:00+08:00",
    });

    expect(runtime.recordInboundMessageAudit).toHaveBeenCalledWith({
      requestId: "req-inbound-audit",
      channel: "wecom",
      accountId: "acct-demo",
      senderId: "wecom-user-42",
      senderName: "李人培-安阳市区运营总",
      conversationId: "chat-yiwu",
      threadId: "thread-7",
      isGroup: true,
      wasMentioned: true,
      platformMessageId: "msg-42",
      content: "@荷塘AI小助手1号 这几天义乌店的点钟率多少？加钟多少？",
      effectiveContent: "@荷塘AI小助手1号 这几天义乌店的点钟率多少？加钟多少？",
      receivedAt: "2026-04-14T00:30:00+08:00",
    });
  });

  it("keeps replying even when inbound audit persistence fails", async () => {
    const runtime = buildRuntime();
    runtime.recordInboundMessageAudit.mockRejectedValue(new Error("audit down"));
    const logger = buildLogger();
    const service = createHetangMessageEntryService({
      config: buildConfig(),
      runtime: runtime as never,
      logger,
    });

    const response = await service.handleInboundMessage({
      request_id: "req-inbound-audit-fail-open",
      channel: "wecom",
      sender_id: "user-identity",
      conversation_id: "conv-identity",
      is_group: false,
      content: "你是谁",
      received_at: "2026-04-10T20:00:00+08:00",
    });

    expect(response.reply?.text).toContain("荷塘AI小助手");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("inbound audit persistence failed"),
    );
  });

  it("does not block a cheap inbound reply on slow audit persistence", async () => {
    let releaseAudit: (() => void) | undefined;
    const runtime = buildRuntime();
    runtime.recordInboundMessageAudit.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseAudit = () => resolve();
        }),
    );
    const service = createHetangMessageEntryService({
      config: buildConfig(),
      runtime: runtime as never,
      logger: buildLogger(),
    });

    const responsePromise = service.handleInboundMessage({
      request_id: "req-inbound-audit-slow",
      channel: "wecom",
      sender_id: "user-identity",
      conversation_id: "conv-identity",
      is_group: false,
      content: "你是谁",
      received_at: "2026-04-10T20:00:00+08:00",
    });

    const raced = await Promise.race([
      responsePromise.then((response) => ({
        kind: "response" as const,
        response,
      })),
      new Promise<{ kind: "timeout" }>((resolve) => {
        setTimeout(() => resolve({ kind: "timeout" }), 0);
      }),
    ]);

    expect(raced.kind).toBe("response");
    if (raced.kind === "response") {
      expect(raced.response.reply?.text).toContain("荷塘AI小助手");
    }

    releaseAudit?.();
    await responsePromise;
  });

  it("repairs a guarded inbound reply before returning it to the bridge caller", async () => {
    const logger = buildLogger();
    const replies = [
      "迎宾店 2026-04-12 指标查询\n- 服务营收: 2680.00 元",
      "义乌店 2026-04-12 指标查询\n- 服务营收: 3200.00 元",
    ];
    const service = createHetangMessageEntryService({
      config: buildConfig({
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
      }),
      runtime: buildRuntime() as never,
      logger,
      inboundHandlerFactory: (capture) => async () => {
        capture.current = {
          channel: "wecom",
          target: "conv-1",
          message: replies.shift() ?? "",
        };
        return { handled: true };
      },
    });

    const response = await service.handleInboundMessage({
      request_id: "req-inbound-guard-repair",
      channel: "wecom",
      sender_id: "user-1",
      conversation_id: "conv-1",
      is_group: false,
      content: "义乌店昨天营收多少",
      received_at: "2026-04-10T20:00:00+08:00",
    });

    expect(response.reply?.text).toContain("义乌店");
    expect(response.reply?.text).not.toContain("迎宾店");
  });

  it("downgrades business capability templates into a clarification before returning to the bridge caller", async () => {
    const service = createHetangMessageEntryService({
      config: buildConfig(),
      runtime: buildRuntime() as never,
      logger: buildLogger(),
      inboundHandlerFactory: (capture) => async () => {
        capture.current = {
          channel: "wecom",
          target: "conv-1",
          message: "当前已支持：\n- 昨天营收\n- 近7天经营复盘",
        };
        return { handled: true };
      },
    });

    const response = await service.handleInboundMessage({
      request_id: "req-inbound-guard-clarify",
      channel: "wecom",
      sender_id: "user-1",
      conversation_id: "conv-1",
      is_group: false,
      content: "迎宾店营收怎么样",
      received_at: "2026-04-10T20:00:00+08:00",
    });

    expect(response.reply?.text).toBe("你要看迎宾店昨天、近7天还是近30天？");
    expect(response.reply?.text).not.toContain("当前已支持");
  });

  it("uses the previous turn to repair a live correction instead of sending correction chatter", async () => {
    const logger = buildLogger();
    const service = createHetangMessageEntryService({
      config: buildConfig({
        conversationQuality: {
          replyGuard: {
            enabled: false,
          },
        },
      }),
      runtime: buildRuntime() as never,
      logger,
      inboundHandlerFactory: (capture) => async (event) => {
        capture.current = {
          channel: "wecom",
          target: "conv-1",
          message:
            event.content === "义乌店营收怎么样"
              ? "义乌店 2026-04-12 指标查询\n- 服务营收: 3200.00 元"
              : "当前已支持：\n- 昨天营收",
        };
        return { handled: true };
      },
    });

    const first = await service.handleInboundMessage({
      request_id: "req-inbound-correction-1",
      channel: "wecom",
      sender_id: "user-1",
      conversation_id: "conv-1",
      is_group: false,
      content: "义乌店营收怎么样",
      received_at: "2026-04-10T20:00:00+08:00",
    });
    const second = await service.handleInboundMessage({
      request_id: "req-inbound-correction-2",
      channel: "wecom",
      sender_id: "user-1",
      conversation_id: "conv-1",
      is_group: false,
      content: "不是这个意思，别套模板",
      received_at: "2026-04-10T20:00:10+08:00",
    });

    expect(first.reply?.text).toContain("服务营收");
    expect(second.reply?.text).toContain("我按刚才那条门店问题重答");
    expect(second.reply?.text).toContain("服务营收");
    expect(second.reply?.text).not.toContain("当前已支持");
  });

  it("emits shadow route telemetry without changing the legacy reply", async () => {
    const logger = buildLogger();
    const runtime = buildRuntime();
    runtime.resolveControlTowerSettings.mockResolvedValue({
      "routing.mode": "shadow",
    });
    const service = createHetangMessageEntryService({
      config: buildConfig(),
      runtime: runtime as never,
      logger,
    });

    const response = await service.handleInboundMessage({
      request_id: "req-inbound-shadow-route",
      channel: "bridge",
      sender_id: "user-1",
      conversation_id: "conv-1",
      is_group: false,
      content: "你是谁",
      received_at: "2026-04-10T20:00:00+08:00",
    });

    expect(response.reply?.text).toContain("荷塘AI小助手");

    const loggedText = logger.info.mock.calls
      .flatMap((call) => call.filter((value): value is string => typeof value === "string"))
      .join("\n");
    expect(loggedText).toContain('"routingMode":"shadow"');
    expect(loggedText).toContain('"frontDoorDecision":"legacy_pass"');
    expect(loggedText).toContain('"legacyRoute":"meta:identity"');
    expect(loggedText).toContain('"semanticRoute":"meta:identity"');
  });

  it("emits fine-grained shadow route kinds for clarification branches", async () => {
    const logger = buildLogger();
    const runtime = buildRuntime();
    runtime.resolveControlTowerSettings.mockResolvedValue({
      "routing.mode": "shadow",
    });
    const service = createHetangMessageEntryService({
      config: buildConfig(),
      runtime: runtime as never,
      logger,
    });

    const response = await service.handleInboundMessage({
      request_id: "req-inbound-shadow-clarify-kind",
      channel: "bridge",
      sender_id: "user-1",
      conversation_id: "conv-1",
      is_group: false,
      content: "迎宾店营收怎么样",
      received_at: "2026-04-10T20:00:00+08:00",
    });

    expect(response.reply?.text).toBe("你要看迎宾店昨天、近7天还是近30天？");

    const loggedText = logger.info.mock.calls
      .flatMap((call) => call.filter((value): value is string => typeof value === "string"))
      .join("\n");
    expect(loggedText).toContain('"legacyRoute":"meta:clarify_missing_time"');
    expect(loggedText).toContain('"semanticRoute":"meta:clarify_missing_time"');
  });

  it("feeds inherited semantic-state text into the inbound path when the next turn only supplies the missing slot", async () => {
    const logger = buildLogger();
    const runtime = buildRuntime();
    runtime.resolveControlTowerSettings.mockResolvedValue({
      "routing.mode": "shadow",
    });
    const inboundHandler = vi.fn(async () => ({ handled: true as const }));
    const resolveTurnState = vi.fn(async () => ({
      sessionId: "wecom:conv-1",
      snapshot: {
        sessionId: "wecom:conv-1",
        channel: "wecom",
        clarificationPending: true,
        clarificationReason: "missing-time",
        anchoredSlots: {},
        missingSlots: ["time"],
        beliefState: {
          pendingText: "迎宾店营收怎么样",
        },
        desireState: {},
        intentionState: {},
        updatedAt: "2026-04-17T09:00:00.000Z",
        expiresAt: "2026-04-17T10:00:00.000Z",
      },
      effectiveText: "迎宾店营收怎么样 近7天",
      stateCarriedForward: true,
      topicSwitchDetected: false,
    }));
    const recordTurnResult = vi.fn().mockResolvedValue(undefined);
    const service = createHetangMessageEntryService({
      config: buildConfig(),
      runtime: runtime as never,
      logger,
      conversationSemanticStateService: {
        resolveTurnState,
        recordTurnResult,
      } as never,
      inboundHandlerFactory: () => inboundHandler,
    });

    await service.handleInboundMessage({
      request_id: "req-inbound-shadow-semantic-state-carry",
      channel: "wecom",
      sender_id: "user-1",
      conversation_id: "conv-1",
      is_group: false,
      content: "近7天",
      received_at: "2026-04-17T09:30:00+08:00",
    });

    expect(resolveTurnState).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "近7天",
        channel: "wecom",
        senderId: "user-1",
        conversationId: "conv-1",
      }),
    );
    expect(inboundHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "迎宾店营收怎么样 近7天",
      }),
      expect.any(Object),
    );
    expect(recordTurnResult).toHaveBeenCalled();
  });

  it("feeds missing-metric carry text into the inbound path for boss-style metric supplements", async () => {
    const logger = buildLogger();
    const runtime = buildRuntime();
    runtime.resolveControlTowerSettings.mockResolvedValue({
      "routing.mode": "shadow",
    });
    const inboundHandler = vi.fn(async () => ({ handled: true as const }));
    const resolveTurnState = vi.fn(async () => ({
      sessionId: "wecom:conv-1",
      snapshot: {
        sessionId: "wecom:conv-1",
        channel: "wecom",
        clarificationPending: true,
        clarificationReason: "missing-metric",
        anchoredSlots: {},
        missingSlots: ["metric"],
        beliefState: {
          pendingText: "迎宾店近7天重点看什么",
        },
        desireState: {},
        intentionState: {},
        updatedAt: "2026-04-17T09:00:00.000Z",
        expiresAt: "2026-04-17T10:00:00.000Z",
      },
      effectiveText: "迎宾店近7天重点看什么 就看卡里还有多少",
      stateCarriedForward: true,
      topicSwitchDetected: false,
    }));
    const recordTurnResult = vi.fn().mockResolvedValue(undefined);
    const service = createHetangMessageEntryService({
      config: buildConfig(),
      runtime: runtime as never,
      logger,
      conversationSemanticStateService: {
        resolveTurnState,
        recordTurnResult,
      } as never,
      inboundHandlerFactory: () => inboundHandler,
    });

    await service.handleInboundMessage({
      request_id: "req-inbound-shadow-semantic-state-metric-carry",
      channel: "wecom",
      sender_id: "user-1",
      conversation_id: "conv-1",
      is_group: false,
      content: "就看卡里还有多少",
      received_at: "2026-04-17T09:30:00+08:00",
    });

    expect(inboundHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "迎宾店近7天重点看什么 就看卡里还有多少",
      }),
      expect.any(Object),
    );
    expect(recordTurnResult).toHaveBeenCalled();
  });

  it("records semantic quality audits for clarify replies on the inbound semantic front door", async () => {
    const logger = buildLogger();
    const runtime = buildRuntime();
    runtime.resolveControlTowerSettings.mockResolvedValue({
      "routing.mode": "shadow",
    });
    runtime.getCurrentServingVersion = vi.fn().mockResolvedValue("serving-20260418040000");
    const recordSemanticExecutionAudit = vi.fn().mockResolvedValue(undefined);
    const service = createHetangMessageEntryService({
      config: buildConfig(),
      runtime: runtime as never,
      logger,
      semanticQualityService: {
        recordSemanticExecutionAudit,
      } as never,
    });

    await service.handleInboundMessage({
      request_id: "req-inbound-semantic-quality-clarify",
      channel: "wecom",
      sender_id: "user-1",
      conversation_id: "conv-1",
      is_group: false,
      content: "迎宾店营收怎么样",
      received_at: "2026-04-17T09:30:00+08:00",
    });

    expect(recordSemanticExecutionAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        entry: "inbound",
        rawText: "迎宾店营收怎么样",
        effectiveText: "迎宾店营收怎么样",
        semanticLane: "meta",
        intentKind: "clarify_missing_time",
        clarificationNeeded: true,
        clarificationReason: "missing-time",
        servingVersion: "serving-20260418040000",
        deployMarker: "serving:serving-20260418040000",
        success: false,
      }),
    );
  });

  it("records carried-forward and topic-switch flags in semantic quality audits", async () => {
    const logger = buildLogger();
    const runtime = buildRuntime();
    runtime.resolveControlTowerSettings.mockResolvedValue({
      "routing.mode": "shadow",
    });
    runtime.getCurrentServingVersion = vi.fn().mockResolvedValue("serving-20260418040000");
    const recordSemanticExecutionAudit = vi.fn().mockResolvedValue(undefined);
    const service = createHetangMessageEntryService({
      config: buildConfig(),
      runtime: runtime as never,
      logger,
      conversationSemanticStateService: {
        resolveTurnState: vi.fn().mockResolvedValue({
          sessionId: "wecom:conv-1",
          snapshot: null,
          effectiveText: "迎宾店近7天营收多少 顾客呢",
          stateCarriedForward: true,
          topicSwitchDetected: false,
        }),
        recordTurnResult: vi.fn().mockResolvedValue(undefined),
      } as never,
      semanticQualityService: {
        recordSemanticExecutionAudit,
      } as never,
      inboundHandlerFactory: (capture) => async () => {
        capture.route = {
          lane: "query",
          kind: "query",
          action: "summary",
        };
        capture.current = {
          channel: "wecom",
          target: "conv-1",
          message: "迎宾店近7天营收 3200 元。",
        };
        return { handled: true };
      },
    });

    await service.handleInboundMessage({
      request_id: "req-inbound-semantic-quality-carry",
      channel: "wecom",
      sender_id: "user-1",
      conversation_id: "conv-1",
      is_group: false,
      content: "顾客呢",
      received_at: "2026-04-17T09:30:00+08:00",
    });

    expect(recordSemanticExecutionAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        stateCarriedForward: true,
        topicSwitchDetected: false,
      }),
    );
  });

  it("feeds inherited carry text into the inbound path for risk follow-up", async () => {
    const logger = buildLogger();
    const runtime = buildRuntime();
    runtime.resolveControlTowerSettings.mockResolvedValue({
      "routing.mode": "shadow",
    });
    const inboundHandler = vi.fn(async () => ({ handled: true as const }));
    const resolveTurnState = vi.fn(async () => ({
      sessionId: "wecom:conv-1",
      snapshot: null,
      effectiveText: "迎宾店近7天营收多少 那风险呢",
      stateCarriedForward: true,
      topicSwitchDetected: false,
    }));
    const service = createHetangMessageEntryService({
      config: buildConfig(),
      runtime: runtime as never,
      logger,
      conversationSemanticStateService: {
        resolveTurnState,
        recordTurnResult: vi.fn().mockResolvedValue(undefined),
      } as never,
      inboundHandlerFactory: () => inboundHandler,
    });

    await service.handleInboundMessage({
      request_id: "req-inbound-shadow-semantic-state-risk-carry",
      channel: "wecom",
      sender_id: "user-1",
      conversation_id: "conv-1",
      is_group: false,
      content: "那风险呢",
      received_at: "2026-04-17T09:30:00+08:00",
    });

    expect(inboundHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "迎宾店近7天营收多少 那风险呢",
      }),
      expect.any(Object),
    );
  });

  it("feeds inherited carry text into the inbound path for advice follow-up", async () => {
    const logger = buildLogger();
    const runtime = buildRuntime();
    runtime.resolveControlTowerSettings.mockResolvedValue({
      "routing.mode": "shadow",
    });
    const inboundHandler = vi.fn(async () => ({ handled: true as const }));
    const resolveTurnState = vi.fn(async () => ({
      sessionId: "wecom:conv-1",
      snapshot: null,
      effectiveText: "迎宾店近7天营收多少 建议呢",
      stateCarriedForward: true,
      topicSwitchDetected: false,
    }));
    const service = createHetangMessageEntryService({
      config: buildConfig(),
      runtime: runtime as never,
      logger,
      conversationSemanticStateService: {
        resolveTurnState,
        recordTurnResult: vi.fn().mockResolvedValue(undefined),
      } as never,
      inboundHandlerFactory: () => inboundHandler,
    });

    await service.handleInboundMessage({
      request_id: "req-inbound-shadow-semantic-state-advice-carry",
      channel: "wecom",
      sender_id: "user-1",
      conversation_id: "conv-1",
      is_group: false,
      content: "建议呢",
      received_at: "2026-04-17T09:30:00+08:00",
    });

    expect(inboundHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "迎宾店近7天营收多少 建议呢",
      }),
      expect.any(Object),
    );
  });

  it("uses binding-aware semantic routing in shadow mode for implicit single-store asks", async () => {
    const logger = buildLogger();
    const runtime = buildRuntime();
    runtime.resolveControlTowerSettings.mockResolvedValue({
      "routing.mode": "shadow",
    });
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "user-1",
      employeeName: "迎宾店店长",
      role: "manager",
      orgId: "1001",
      scopeOrgIds: ["1001"],
      isActive: true,
    });
    const service = createHetangMessageEntryService({
      config: buildConfig(),
      runtime: runtime as never,
      logger,
      inboundHandlerFactory: (capture) => async () => {
        capture.route = {
          lane: "query",
          kind: "query",
        };
        capture.current = {
          channel: "bridge",
          target: "conv-1",
          message: "迎宾店昨天服务营收 3200 元。",
        };
        return { handled: true };
      },
    });

    const response = await service.handleInboundMessage({
      request_id: "req-inbound-shadow-binding-aware",
      channel: "wecom",
      sender_id: "user-1",
      conversation_id: "conv-1",
      is_group: false,
      content: "昨天营收多少",
      received_at: "2026-04-10T20:00:00+08:00",
    });

    expect(response.reply?.text).toContain("迎宾店");
    const loggedText = logger.info.mock.calls
      .flatMap((call) => call.filter((value): value is string => typeof value === "string"))
      .join("\n");
    expect(loggedText).toContain('"legacyRoute":"query:summary"');
    expect(loggedText).toContain('"semanticRoute":"query:summary"');
    expect(runtime.getEmployeeBinding).toHaveBeenCalledWith({
      channel: "wecom",
      senderId: "user-1",
    });
  });

  it("emits fine-grained shadow route kinds for business guidance branches", async () => {
    const logger = buildLogger();
    const runtime = buildRuntime();
    runtime.resolveControlTowerSettings.mockResolvedValue({
      "routing.mode": "shadow",
    });
    const service = createHetangMessageEntryService({
      config: buildConfig(),
      runtime: runtime as never,
      logger,
    });

    const response = await service.handleInboundMessage({
      request_id: "req-inbound-shadow-guidance-kind",
      channel: "bridge",
      sender_id: "user-1",
      conversation_id: "conv-1",
      is_group: false,
      content: "最近该召回哪些顾客",
      received_at: "2026-04-10T20:00:00+08:00",
    });

    expect(response.handled).toBe(true);

    const loggedText = logger.info.mock.calls
      .flatMap((call) => call.filter((value): value is string => typeof value === "string"))
      .join("\n");
    expect(loggedText).toContain('"legacyRoute":"meta:guidance_customer_missing_store"');
    expect(loggedText).toContain('"semanticRoute":"meta:guidance_customer_missing_store"');
  });

  it("tags high-confidence HQ portfolio drift when shadow legacy and semantic routes disagree", async () => {
    const logger = buildLogger();
    const runtime = buildRuntime();
    runtime.resolveControlTowerSettings.mockResolvedValue({
      "routing.mode": "shadow",
    });
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "hq-1",
      employeeName: "总部甲",
      role: "hq",
      isActive: true,
      scopeOrgIds: ["1001", "1002", "1003", "1004", "1005"],
    });
    const service = createHetangMessageEntryService({
      config: buildConfig({
        stores: [
          {
            orgId: "1001",
            storeName: "义乌店",
            rawAliases: ["义乌"],
            notification: { channel: "wecom", target: "room-yiwu" },
          },
          {
            orgId: "1002",
            storeName: "华美店",
            rawAliases: ["华美"],
            notification: { channel: "wecom", target: "room-huamei" },
          },
          {
            orgId: "1003",
            storeName: "园中园店",
            rawAliases: ["园中园"],
            notification: { channel: "wecom", target: "room-yuanzhongyuan" },
          },
          {
            orgId: "1004",
            storeName: "迎宾店",
            rawAliases: ["迎宾"],
            notification: { channel: "wecom", target: "room-yingbin" },
          },
          {
            orgId: "1005",
            storeName: "锦苑店",
            rawAliases: ["锦苑"],
            notification: { channel: "wecom", target: "room-jinyuan" },
          },
        ],
      }),
      runtime: runtime as never,
      logger,
      inboundHandlerFactory: (capture) => async () => {
        capture.route = {
          lane: "meta",
          kind: "guidance_store_missing_time_range",
        };
        capture.current = {
          channel: "wecom",
          target: "conv-hq",
          message: "这家店还差时间范围。直接补昨天 / 近7天 / 近30天，我就能答。",
        };
        return { handled: true };
      },
    });

    const response = await service.handleInboundMessage({
      request_id: "req-inbound-shadow-hq-portfolio-drift",
      channel: "wecom",
      sender_id: "hq-1",
      conversation_id: "conv-hq",
      is_group: false,
      content: "哪个门店须重点关注",
      received_at: "2026-04-10T20:00:00+08:00",
    });

    expect(response.reply?.text).toContain("时间范围");

    const routeCompare = extractRouteComparePayload(logger);
    expect(routeCompare.legacyRoute).toBe("meta:guidance_store_missing_time_range");
    expect(routeCompare.semanticRoute).toBe("query:ranking");
    expect(routeCompare.selectedCapabilityId).toBe("hq_window_ranking_v1");
    expect(routeCompare.driftTags).toEqual(["hq_portfolio_high_confidence_route_drift"]);

    const warningText = logger.warn.mock.calls
      .flatMap((call) => call.filter((value): value is string => typeof value === "string"))
      .join("\n");
    expect(warningText).toContain("hetang-ops: route-drift");
    expect(warningText).toContain("hq_portfolio_high_confidence_route_drift");
    expect(warningText).toContain("哪个门店须重点关注");
  });

  it("emits fine-grained shadow route kinds for missing-metric guidance branches", async () => {
    const logger = buildLogger();
    const runtime = buildRuntime();
    runtime.resolveControlTowerSettings.mockResolvedValue({
      "routing.mode": "shadow",
    });
    const service = createHetangMessageEntryService({
      config: buildConfig(),
      runtime: runtime as never,
      logger,
    });

    const response = await service.handleInboundMessage({
      request_id: "req-inbound-shadow-guidance-metric-kind",
      channel: "bridge",
      sender_id: "user-1",
      conversation_id: "conv-1",
      is_group: false,
      content: "迎宾店昨天怎么样",
      received_at: "2026-04-10T20:00:00+08:00",
    });

    expect(response.handled).toBe(true);

    const loggedText = logger.info.mock.calls
      .flatMap((call) => call.filter((value): value is string => typeof value === "string"))
      .join("\n");
    expect(loggedText).toContain('"legacyRoute":"meta:guidance_store_missing_metric"');
    expect(loggedText).toContain('"semanticRoute":"meta:guidance_store_missing_metric"');
  });

  it("emits customer-specific guidance kinds in shadow route telemetry", async () => {
    const logger = buildLogger();
    const runtime = buildRuntime();
    runtime.resolveControlTowerSettings.mockResolvedValue({
      "routing.mode": "shadow",
    });
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "user-1",
      employeeName: "迎宾店店长",
      role: "manager",
      orgId: "1001",
      scopeOrgIds: ["1001"],
      isActive: true,
    });
    const service = createHetangMessageEntryService({
      config: buildConfig(),
      runtime: runtime as never,
      logger,
    });

    const response = await service.handleInboundMessage({
      request_id: "req-inbound-shadow-guidance-customer-time-kind",
      channel: "bridge",
      sender_id: "user-1",
      conversation_id: "conv-1",
      is_group: false,
      content: "迎宾店顾客跟进重点",
      received_at: "2026-04-10T20:00:00+08:00",
    });

    expect(response.handled).toBe(true);

    const loggedText = logger.info.mock.calls
      .flatMap((call) => call.filter((value): value is string => typeof value === "string"))
      .join("\n");
    expect(loggedText).toContain('"legacyRoute":"meta:guidance_customer_missing_time_range"');
    expect(loggedText).toContain('"semanticRoute":"meta:guidance_customer_missing_time_range"');
  });

  it("serves semantic meta replies directly when routing.mode is semantic", async () => {
    const logger = buildLogger();
    const runtime = buildRuntime();
    runtime.resolveControlTowerSettings.mockResolvedValue({
      "routing.mode": "semantic",
    });
    const service = createHetangMessageEntryService({
      config: buildConfig(),
      runtime: runtime as never,
      logger,
      inboundHandlerFactory: () => async () => {
        throw new Error("legacy inbound should not run in semantic mode");
      },
    });

    const response = await service.handleInboundMessage({
      request_id: "req-inbound-semantic-meta",
      channel: "bridge",
      sender_id: "user-1",
      conversation_id: "conv-1",
      is_group: false,
      content: "什么是复盘，如何复盘？",
      received_at: "2026-04-10T20:00:00+08:00",
    });

    expect(response.reply?.text).toContain("复盘");
    expect(response.reply?.text).toContain("先看事实");

    const loggedText = logger.info.mock.calls
      .flatMap((call) => call.filter((value): value is string => typeof value === "string"))
      .join("\n");
    expect(loggedText).toContain('"routingMode":"semantic"');
    expect(loggedText).toContain('"frontDoorDecision":"semantic_meta_early_stop"');
    expect(loggedText).toContain('"legacyRoute":"query:report"');
    expect(loggedText).toContain('"semanticRoute":"meta:concept_explain"');
    expect(loggedText).toContain('"legacyCapabilityId":"store_report_v1"');
    expect(loggedText).toContain('"selectedCapabilityId":null');
  });

  it("serves semantic query replies directly when routing.mode is semantic", async () => {
    const logger = buildLogger();
    const runtime = buildRuntime();
    runtime.resolveControlTowerSettings.mockResolvedValue({
      "routing.mode": "semantic",
    });
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "user-1",
      employeeName: "迎宾店店长",
      role: "manager",
        orgId: "1001",
        scopeOrgIds: ["1001"],
        isActive: true,
      });
    const commandRunner = vi.fn();
    const queryRunner = vi.fn().mockResolvedValue("迎宾店昨天服务营收 3200 元。");
    const service = createHetangMessageEntryService({
      config: buildConfig(),
      runtime: runtime as never,
      logger,
      commandRunner: commandRunner as never,
      queryRunner: queryRunner as never,
      inboundHandlerFactory: () => async () => {
        throw new Error("legacy inbound should not run in semantic mode");
      },
    });

    const response = await service.handleInboundMessage({
      request_id: "req-inbound-semantic-query",
      channel: "wecom",
      sender_id: "user-1",
      conversation_id: "conv-1",
      is_group: false,
      content: "昨天营收多少",
      received_at: "2026-04-10T20:00:00+08:00",
    });

    expect(response.reply?.text).toContain("迎宾店");
    expect(queryRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        queryText: "昨天营收多少",
        channel: "wecom",
        senderId: "user-1",
      }),
    );
    expect(commandRunner).not.toHaveBeenCalled();

    const routeCompare = extractRouteComparePayload(logger);
    expect(routeCompare.legacyCapabilityId).toBe("store_day_summary_v1");
    expect(routeCompare.selectedCapabilityId).toBe("store_day_summary_v1");
    expect(routeCompare.semanticRoute).toBe("query:summary");
    expect(routeCompare.frontDoorPrechecks).toMatchObject({
      groupNoop: false,
      routingControlsResolved: true,
      bindingLookupCompleted: true,
      semanticIntentResolved: true,
      legacyCompareRouteResolved: true,
      effectiveRoutingMode: "semantic",
    });
  });

  it("serves semantic analysis queue replies directly when routing.mode is semantic", async () => {
    const logger = buildLogger();
    const runtime = buildRuntime();
    runtime.resolveControlTowerSettings.mockResolvedValue({
      "routing.mode": "semantic",
    });
    const service = createHetangMessageEntryService({
      config: buildConfig(),
      runtime: runtime as never,
      logger,
      inboundHandlerFactory: () => async () => {
        throw new Error("legacy inbound should not run in semantic mode");
      },
    });

    const response = await service.handleInboundMessage({
      request_id: "req-inbound-semantic-analysis",
      channel: "bridge",
      sender_id: "user-1",
      conversation_id: "conv-1",
      is_group: false,
      content: "迎宾店近30天为什么承压，给我做个深度复盘",
      received_at: "2026-04-10T20:00:00+08:00",
    });

    expect(response.reply?.text).toContain("已收到");
    expect(runtime.enqueueAnalysisJob).toHaveBeenCalledTimes(1);

    const loggedText = logger.info.mock.calls
      .flatMap((call) => call.filter((value): value is string => typeof value === "string"))
      .join("\n");
    expect(loggedText).toContain('"routingMode":"semantic"');
    expect(loggedText).toContain('"frontDoorDecision":"semantic_analysis_direct"');
    expect(loggedText).toContain('"legacyRoute":"analysis:analysis"');
    expect(loggedText).toContain('"semanticRoute":"analysis:analysis"');
    expect(loggedText).toContain('"legacyCapabilityId":"store_review_async_v1"');
    expect(loggedText).toContain('"selectedCapabilityId":"store_review_async_v1"');
  });

  it("emits fine-grained shadow route kinds for structured report draft branches", async () => {
    const logger = buildLogger();
    const runtime = buildRuntime();
    runtime.resolveControlTowerSettings.mockResolvedValue({
      "routing.mode": "shadow",
    });
    const service = createHetangMessageEntryService({
      config: buildConfig(),
      runtime: runtime as never,
      logger,
    });

    const response = await service.handleInboundMessage({
      request_id: "req-inbound-shadow-structured-report-kind",
      channel: "bridge",
      sender_id: "user-1",
      conversation_id: "conv-1",
      is_group: false,
      content: [
        "我需要一份日报",
        "2026年4月13日 义乌店经营数据报告",
        "服务营收：3200元",
        "总钟数：128个",
        "点钟数：46个",
      ].join("\n"),
      received_at: "2026-04-10T20:00:00+08:00",
    });

    expect(response.handled).toBe(true);

    const loggedText = logger.info.mock.calls
      .flatMap((call) => call.filter((value): value is string => typeof value === "string"))
      .join("\n");
    expect(loggedText).toContain('"legacyRoute":"meta:structured_report_draft"');
    expect(loggedText).toContain('"semanticRoute":"meta:structured_report_draft"');
  });

  it("emits shadow route kinds for business correction branches", async () => {
    const logger = buildLogger();
    const runtime = buildRuntime();
    runtime.resolveControlTowerSettings.mockResolvedValue({
      "routing.mode": "shadow",
    });
    const service = createHetangMessageEntryService({
      config: buildConfig(),
      runtime: runtime as never,
      logger,
    });

    const response = await service.handleInboundMessage({
      request_id: "req-inbound-shadow-correction-kind",
      channel: "bridge",
      sender_id: "user-1",
      conversation_id: "conv-1",
      is_group: false,
      content: "乱回，别套模板",
      received_at: "2026-04-10T20:00:00+08:00",
    });

    expect(response.handled).toBe(true);

    const loggedText = logger.info.mock.calls
      .flatMap((call) => call.filter((value): value is string => typeof value === "string"))
      .join("\n");
    expect(loggedText).toContain('"legacyRoute":"meta:business_correction"');
    expect(loggedText).toContain('"semanticRoute":"meta:business_correction"');
  });

  it("emits shadow route kinds for unsupported forecast branches", async () => {
    const logger = buildLogger();
    const runtime = buildRuntime();
    runtime.resolveControlTowerSettings.mockResolvedValue({
      "routing.mode": "shadow",
    });
    const service = createHetangMessageEntryService({
      config: buildConfig(),
      runtime: runtime as never,
      logger,
    });

    const response = await service.handleInboundMessage({
      request_id: "req-inbound-shadow-unsupported-forecast",
      channel: "bridge",
      sender_id: "user-1",
      conversation_id: "conv-1",
      is_group: false,
      content: "明天客流预测多少",
      received_at: "2026-04-10T20:00:00+08:00",
    });

    expect(response.handled).toBe(true);

    const loggedText = logger.info.mock.calls
      .flatMap((call) => call.filter((value): value is string => typeof value === "string"))
      .join("\n");
    expect(loggedText).toContain('"legacyRoute":"meta:unsupported_forecast"');
    expect(loggedText).toContain('"semanticRoute":"meta:unsupported_forecast"');
  });

  it("emits shadow route kinds for negative constraint branches", async () => {
    const logger = buildLogger();
    const runtime = buildRuntime();
    runtime.resolveControlTowerSettings.mockResolvedValue({
      "routing.mode": "shadow",
    });
    const service = createHetangMessageEntryService({
      config: buildConfig(),
      runtime: runtime as never,
      logger,
    });

    const response = await service.handleInboundMessage({
      request_id: "req-inbound-shadow-negative-constraint",
      channel: "bridge",
      sender_id: "user-1",
      conversation_id: "conv-1",
      is_group: false,
      content: "不要经营复盘",
      received_at: "2026-04-10T20:00:00+08:00",
    });

    expect(response.handled).toBe(true);

    const loggedText = logger.info.mock.calls
      .flatMap((call) => call.filter((value): value is string => typeof value === "string"))
      .join("\n");
    expect(loggedText).toContain('"legacyRoute":"meta:negative_constraint"');
    expect(loggedText).toContain('"semanticRoute":"meta:negative_constraint"');
  });

  it("emits metaQueryProbeOutcome in shadow telemetry for guidance branches", async () => {
    const logger = buildLogger();
    const runtime = buildRuntime();
    runtime.resolveControlTowerSettings.mockResolvedValue({
      "routing.mode": "shadow",
    });
    const service = createHetangMessageEntryService({
      config: buildConfig(),
      runtime: runtime as never,
      logger,
    });

    await service.handleInboundMessage({
      request_id: "req-inbound-shadow-probe-outcome",
      channel: "bridge",
      sender_id: "user-1",
      conversation_id: "conv-1",
      is_group: false,
      content: "最近该召回哪些顾客",
      received_at: "2026-04-10T20:00:00+08:00",
    });

    const loggedText = logger.info.mock.calls
      .flatMap((call) => call.filter((value): value is string => typeof value === "string"))
      .join("\n");
    expect(loggedText).toContain('"semanticMetaQueryProbeOutcome"');
  });

  it("serves semantic clarification replies through the explicit early-stop gate", async () => {
    const logger = buildLogger();
    const runtime = buildRuntime();
    runtime.resolveControlTowerSettings.mockResolvedValue({
      "routing.mode": "semantic",
    });
    const service = createHetangMessageEntryService({
      config: buildConfig(),
      runtime: runtime as never,
      logger,
      inboundHandlerFactory: () => async () => {
        throw new Error("legacy inbound should not run for semantic early-stop replies");
      },
    });

    const response = await service.handleInboundMessage({
      request_id: "req-inbound-semantic-clarify-stop",
      channel: "bridge",
      sender_id: "user-1",
      conversation_id: "conv-1",
      is_group: false,
      content: "迎宾店营收怎么样",
      received_at: "2026-04-10T20:00:00+08:00",
    });

    expect(response.reply?.text).toBe("你要看迎宾店昨天、近7天还是近30天？");

    const loggedText = logger.info.mock.calls
      .flatMap((call) => call.filter((value): value is string => typeof value === "string"))
      .join("\n");
    expect(loggedText).toContain('"routingMode":"semantic"');
    expect(loggedText).toContain('"frontDoorDecision":"semantic_meta_early_stop"');
    expect(loggedText).toContain('"semanticRoute":"meta:clarify_missing_time"');
  });

  it("promotes a canary sender into semantic mode even when the base routing mode is shadow", async () => {
    const logger = buildLogger();
    const runtime = buildRuntime();
    runtime.resolveControlTowerSettings.mockResolvedValue({
      "routing.mode": "shadow",
      "routing.semanticCanarySenderIds": "user-canary,user-other",
    });
    const queryRunner = vi.fn().mockResolvedValue("迎宾店昨天服务营收 3200 元。");
    const service = createHetangMessageEntryService({
      config: buildConfig(),
      runtime: runtime as never,
      logger,
      queryRunner: queryRunner as never,
      inboundHandlerFactory: () => async () => {
        throw new Error("legacy inbound should not run for canary semantic requests");
      },
    });

    const response = await service.handleInboundMessage({
      request_id: "req-inbound-shadow-canary-semantic",
      channel: "wecom",
      sender_id: "user-canary",
      conversation_id: "conv-1",
      is_group: false,
      content: "什么是复盘，如何复盘？",
      received_at: "2026-04-10T20:00:00+08:00",
    });

    expect(response.reply?.text).toContain("复盘");
    expect(queryRunner).not.toHaveBeenCalled();

    const loggedText = logger.info.mock.calls
      .flatMap((call) => call.filter((value): value is string => typeof value === "string"))
      .join("\n");
    expect(loggedText).toContain('"baseRoutingMode":"shadow"');
    expect(loggedText).toContain('"effectiveRoutingMode":"semantic"');
    expect(loggedText).toContain('"semanticCanaryApplied":true');
  });

  it("accepts slow inbound requests after 2 seconds and delivers the final reply asynchronously", async () => {
    vi.useFakeTimers();
    const logger = buildLogger();
    const runtime = buildRuntime();
    let releaseHandler: (() => void) | undefined;
    const handlerGate = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });
    const releaseGate = () => {
      const handler = releaseHandler;
      releaseHandler = undefined;
      handler?.();
    };
    const deliverNotificationMessage = vi.fn().mockResolvedValue(undefined);
    const service = createHetangMessageEntryService({
      config: buildConfig(),
      runtime: runtime as never,
      logger,
      deliverNotificationMessage,
      inboundHandlerFactory: (capture) => async () => {
        await handlerGate;
        capture.current = {
          channel: "wecom",
          target: "conv-slow",
          accountId: "acct-slow",
          threadId: "thread-slow",
          message: "迎宾店昨天服务营收 3200 元。",
        };
        return { handled: true };
      },
    });

    const responsePromise = service.handleInboundMessage({
      request_id: "req-inbound-slow-accepted",
      channel: "wecom",
      account_id: "acct-slow",
      sender_id: "user-slow",
      conversation_id: "conv-slow",
      thread_id: "thread-slow",
      is_group: false,
      content: "昨天营收多少",
      received_at: "2026-04-15T22:40:00+08:00",
    });
    let settledResponse: HetangBridgeResponse | null = null;
    void responsePromise.then((response) => {
      settledResponse = response;
    });

    try {
      await vi.advanceTimersByTimeAsync(2_000);
      await Promise.resolve();

      expect(settledResponse).toMatchObject({
        ok: true,
        handled: true,
        reply: {
          mode: "accepted",
          text: "收到，在处理。",
        },
        audit: {
          entry: "inbound",
        },
      });
      expect(deliverNotificationMessage).not.toHaveBeenCalled();

      releaseGate();
      await responsePromise;
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();

      expect(deliverNotificationMessage).toHaveBeenCalledWith({
        notification: {
          channel: "wecom",
          target: "conv-slow",
          accountId: "acct-slow",
          threadId: "thread-slow",
          enabled: true,
        },
        message: "迎宾店昨天服务营收 3200 元。",
      });
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("inbound accepted request_id=req-inbound-slow-accepted"),
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("deferred inbound delivery attempt for req-inbound-slow-accepted"),
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("deferred inbound delivery succeeded for req-inbound-slow-accepted"),
      );
    } finally {
      releaseGate();
      vi.useRealTimers();
    }
  });

  it("sends a safe failure follow-up when an accepted inbound request later crashes", async () => {
    vi.useFakeTimers();
    const logger = buildLogger();
    const runtime = buildRuntime();
    let rejectHandler: ((error: Error) => void) | undefined;
    const handlerGate = new Promise<void>((_resolve, reject) => {
      rejectHandler = reject;
    });
    const rejectGate = (error: Error) => {
      const handler = rejectHandler;
      rejectHandler = undefined;
      handler?.(error);
    };
    const deliverNotificationMessage = vi.fn().mockResolvedValue(undefined);
    const service = createHetangMessageEntryService({
      config: buildConfig(),
      runtime: runtime as never,
      logger,
      deliverNotificationMessage,
      inboundHandlerFactory: () => async () => {
        await handlerGate;
        return { handled: true };
      },
    });

    const responsePromise = service.handleInboundMessage({
      request_id: "req-inbound-slow-failure",
      channel: "wecom",
      account_id: "acct-slow",
      sender_id: "user-slow",
      conversation_id: "conv-slow",
      thread_id: "thread-slow",
      is_group: false,
      content: "昨天营收多少",
      received_at: "2026-04-15T22:41:00+08:00",
    });
    let settledResponse: HetangBridgeResponse | null = null;
    void responsePromise
      .then((response) => {
        settledResponse = response;
      })
      .catch(() => undefined);

    try {
      await vi.advanceTimersByTimeAsync(2_000);
      await Promise.resolve();

      if (!settledResponse) {
        throw new Error("expected accepted bridge response");
      }
      const acceptedResponse = settledResponse as HetangBridgeResponse;
      expect(acceptedResponse.reply).toMatchObject({
        mode: "accepted",
        text: "收到，在处理。",
      });

      rejectGate(new Error("query pipeline crashed"));
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();

      expect(deliverNotificationMessage).toHaveBeenCalledWith({
        notification: {
          channel: "wecom",
          target: "conv-slow",
          accountId: "acct-slow",
          threadId: "thread-slow",
          enabled: true,
        },
        message: "刚才那条问题处理中断了，请稍后再试。",
      });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("deferred inbound processing failed"),
      );
    } finally {
      rejectGate(new Error("test cleanup"));
      await Promise.resolve();
      vi.useRealTimers();
    }
  });

  it("uses a xiaohongshu-specific accepted text before sending the deferred summary", async () => {
    vi.useFakeTimers();
    const logger = buildLogger();
    const runtime = buildRuntime();
    let resolveReply: ((value: string) => void) | undefined;
    const replyGate = new Promise<string>((resolve) => {
      resolveReply = resolve;
    });
    const deliverNotificationMessage = vi.fn().mockResolvedValue(undefined);
    const service = createHetangMessageEntryService({
      config: buildConfig({
        inboundLinkReaders: {
          xiaohongshu: {
            enabled: true,
            acceptText: "收到，正在读取。",
          },
        },
      }),
      runtime: runtime as never,
      logger,
      deliverNotificationMessage,
      xiaohongshuLinkService: {
        canHandleText: vi.fn().mockReturnValue(true),
        buildReplyForText: vi.fn().mockImplementation(async () => await replyGate),
      } as never,
    });

    const responsePromise = service.handleInboundMessage({
      request_id: "req-inbound-xhs-accepted",
      channel: "wecom",
      account_id: "acct-xhs",
      sender_id: "user-xhs",
      conversation_id: "conv-xhs",
      thread_id: "thread-xhs",
      is_group: false,
      content: "https://xhslink.com/a/AbCdEfGhIjKl",
      received_at: "2026-04-19T13:40:00+08:00",
    });
    let settledResponse: HetangBridgeResponse | null = null;
    void responsePromise.then((response) => {
      settledResponse = response;
    });

    try {
      await vi.advanceTimersByTimeAsync(2_000);
      await Promise.resolve();

      expect(settledResponse).toMatchObject({
        ok: true,
        handled: true,
        reply: {
          mode: "accepted",
          text: "收到，正在读取。",
        },
        audit: {
          entry: "inbound",
        },
      });
      expect(deliverNotificationMessage).not.toHaveBeenCalled();

      resolveReply?.("这篇笔记主要在讲春季足疗放松体验，适合下班后舒缓疲劳。");
      await responsePromise;
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();

      expect(deliverNotificationMessage).toHaveBeenCalledWith({
        notification: {
          channel: "wecom",
          target: "conv-xhs",
          accountId: "acct-xhs",
          threadId: "thread-xhs",
          enabled: true,
        },
        message: "这篇笔记主要在讲春季足疗放松体验，适合下班后舒缓疲劳。",
      });
    } finally {
      resolveReply?.("test cleanup");
      await Promise.resolve();
      vi.useRealTimers();
    }
  });
});
