import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseHetangAnalysisResult } from "../analysis-result.js";
import { resolveHetangOpsConfig } from "../config.js";
import type { CommandRunner } from "../notify.js";
import { HetangAnalysisService } from "./analysis-service.js";
import type {
  HetangAnalysisDiagnosticBundle,
  HetangAnalysisEvidencePack,
  HetangAnalysisJob,
} from "../types.js";

function buildConfig(overrides: Record<string, unknown> = {}) {
  return resolveHetangOpsConfig({
    api: {
      appKey: "demo-app-key",
      appSecret: "demo-app-secret",
    },
    database: {
      url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
    },
    stores: [{ orgId: "1001", storeName: "一号店" }],
    ...overrides,
  });
}

const originalCrewAISidecarDir = process.env.HETANG_CREWAI_SIDECAR_DIR;

afterEach(() => {
  if (originalCrewAISidecarDir == null) {
    delete process.env.HETANG_CREWAI_SIDECAR_DIR;
  } else {
    process.env.HETANG_CREWAI_SIDECAR_DIR = originalCrewAISidecarDir;
  }
});

function buildJob(overrides: Partial<HetangAnalysisJob> = {}): HetangAnalysisJob {
  return {
    jobId: overrides.jobId ?? "JOB-1",
    jobType: overrides.jobType ?? "store_review",
    orgId: overrides.orgId ?? "1001",
    storeName: overrides.storeName ?? "一号店",
    rawText: overrides.rawText ?? "一号店近7天经营复盘",
    timeFrameLabel: overrides.timeFrameLabel ?? "近7天",
    startBizDate: overrides.startBizDate ?? "2026-03-23",
    endBizDate: overrides.endBizDate ?? "2026-03-29",
    channel: overrides.channel ?? "wecom",
    target: overrides.target ?? "conversation-1",
    accountId: overrides.accountId,
    threadId: overrides.threadId,
    senderId: overrides.senderId ?? "manager-1",
    status: overrides.status ?? "completed",
    attemptCount: overrides.attemptCount ?? 1,
    resultText: overrides.resultText,
    errorMessage: overrides.errorMessage,
    createdAt: overrides.createdAt ?? "2026-03-30T09:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-03-30T09:02:00.000Z",
    startedAt: overrides.startedAt,
    finishedAt: overrides.finishedAt ?? "2026-03-30T09:02:00.000Z",
    deliveredAt: overrides.deliveredAt,
    queueDisposition: overrides.queueDisposition,
  };
}

function buildService(overrides: {
  store?: Record<string, unknown>;
  runCommandWithTimeout?: CommandRunner;
  buildAnalysisDiagnosticBundle?: (
    evidencePack: HetangAnalysisEvidencePack,
  ) => HetangAnalysisDiagnosticBundle;
  buildAnalysisEvidencePack?: (
    job: HetangAnalysisJob,
  ) => Promise<HetangAnalysisEvidencePack>;
  config?: Record<string, unknown>;
} = {}) {
  const queueStore = {
    resolveControlTowerSettings: vi.fn().mockResolvedValue({}),
    getActionItem: vi.fn().mockResolvedValue(null),
    createActionItem: vi.fn().mockResolvedValue(undefined),
    ...overrides.store,
  };
  const store = {
    getQueueAccessControlStore: vi.fn().mockReturnValue(queueStore),
  };
  const runCommandWithTimeout: CommandRunner =
    overrides.runCommandWithTimeout ??
    vi.fn(async () => ({
      code: 0,
      stdout: "",
      stderr: "",
    }));
  const runScopedQueryAnalysis = vi.fn();
  const buildAnalysisEvidencePack =
    overrides.buildAnalysisEvidencePack ??
    vi.fn().mockResolvedValue({
      scopeType: "single_store",
      orgIds: ["1001"],
      storeName: "一号店",
      timeFrameLabel: "近7天",
      startBizDate: "2026-03-23",
      endBizDate: "2026-03-29",
      question: "一号店近7天经营复盘",
      markdown: [
        "证据包",
        "- 门店: 一号店",
        "- 周期: 2026-03-23 至 2026-03-29（近7天）",
        "- 最新日报: 营收 3200.00 元；总钟数 40.0 个；钟效 80.00 元/钟",
      ].join("\n"),
    });
  const buildAnalysisDiagnosticBundle =
    overrides.buildAnalysisDiagnosticBundle ??
    vi.fn<() => HetangAnalysisDiagnosticBundle>().mockReturnValue({
      version: "v1",
      scopeType: "single_store",
      storeName: "一号店",
      orgIds: ["1001"],
      question: "一号店近7天经营复盘",
      signals: [
        {
          signalId: "point_clock_risk",
          severity: "medium",
          title: "点钟集中风险",
          finding: "当前点钟结构偏高。",
          evidence: ["门店点钟率 32.0%"],
          recommendedFocus: "优先检查点钟集中。",
        },
      ],
    });
  const service = new HetangAnalysisService({
    config: buildConfig(overrides.config),
    logger: {
      info() {},
      warn() {},
      error() {},
    },
    getStore: async () => store as never,
    runCommandWithTimeout,
    resolveStateDir: () => "/tmp/openclaw",
    decorateAnalysisJob: async (job) => job,
    runScopedQueryAnalysis,
    buildAnalysisEvidencePack,
    buildAnalysisDiagnosticBundle,
  });
  return {
    service,
    store: queueStore,
    runCommandWithTimeout,
    runScopedQueryAnalysis,
    buildAnalysisEvidencePack,
    buildAnalysisDiagnosticBundle,
  };
}

describe("HetangAnalysisService", () => {
  it("sanitizes upstream authentication failures in analysis replies", () => {
    const { service } = buildService();

    const reply = service.buildAnalysisReply(
      buildJob({
        status: "failed",
        errorMessage:
          "Error code: 502 - {'error': {'message': 'Upstream authentication failed, please contact administrator'}}",
      }),
    );

    expect(reply).toContain("AI 分析服务鉴权异常，请稍后再试。");
    expect(reply).not.toContain("Upstream authentication failed");
  });

  it("fails fast when the queue access control owner getter is missing", async () => {
    const service = new HetangAnalysisService({
      config: buildConfig(),
      logger: {
        info() {},
        warn() {},
        error() {},
      },
      getStore: async () => ({}) as never,
      runCommandWithTimeout: vi.fn(),
      resolveStateDir: () => "/tmp/openclaw",
      decorateAnalysisJob: async (job) => job,
      runScopedQueryAnalysis: vi.fn(),
      buildAnalysisEvidencePack: vi.fn(),
      buildAnalysisDiagnosticBundle: vi.fn(),
    });

    await expect(service.listAnalysisJobs()).rejects.toThrow(
      "analysis-service requires store.getQueueAccessControlStore()",
    );
  });

  it("caps and de-duplicates auto-created action items from analysis suggestions", async () => {
    const { service, store } = buildService({
      store: {
        resolveControlTowerSettings: vi.fn().mockResolvedValue({
          "analysis.maxActionItems": 2,
        }),
        getActionItem: vi
          .fn()
          .mockResolvedValueOnce({
            actionId: "ACT-JOB-2-1",
          })
          .mockResolvedValueOnce(null),
      },
    });

    const createdCount = await service.autoCreateActionsFromAnalysis(
      buildJob({
        jobId: "JOB-2",
        resultText: [
          "结论摘要：本周钟效走弱，晚场承接不足。",
          "",
          "店长动作建议：",
          "1. 面向近7天未复购会员，今天完成 20 人回访，目标把复购率提升 5 个点。",
          "2. 晚场增加 1 名可承接点钟技师，目标把晚场流失钟数压降 10%。",
          "3. 对抖音团购客加发二次到店券，目标把团购复到店率提升 3 个点。",
        ].join("\n"),
      }),
    );

    expect(createdCount).toBe(1);
    expect((store.createActionItem as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    expect(store.createActionItem).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: "ACT-JOB-2-2",
        orgId: "1001",
        bizDate: "2026-03-29",
        category: "技师运营",
        sourceKind: "analysis",
        sourceRef: "analysis:JOB-2:2",
      }),
    );
  });

  it("prefers structured action items over text scraping", async () => {
    const { service, store } = buildService({
      store: {
        resolveControlTowerSettings: vi.fn().mockResolvedValue({
          "analysis.maxActionItems": 2,
        }),
        getActionItem: vi.fn().mockResolvedValue(null),
      },
    });

    const createdCount = await service.autoCreateActionsFromAnalysis(
      buildJob({
        jobId: "JOB-STRUCTURED",
        resultText: JSON.stringify({
          summary: "近7天钟效走弱。",
          suggestions: ["旧的纯文本建议。"],
          actionItems: [
            {
              title: "针对近7天未复购会员，今天完成20人回访，目标把复购率提升5个点。",
              category: "会员运营",
              priority: "high",
            },
            {
              title: "针对晚场承接偏弱班次，本周补1名可承接点钟技师，目标把流失钟数压降10%。",
            },
          ],
        }),
      }),
    );

    expect(createdCount).toBe(2);
    expect(store.createActionItem).toHaveBeenCalledTimes(2);
    expect(store.createActionItem).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        actionId: "ACT-JOB-STRUCTURED-1",
        category: "会员运营",
        priority: "high",
        title: "针对近7天未复购会员，今天完成20人回访，目标把复购率提升5个点。",
      }),
    );
    expect(store.createActionItem).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        actionId: "ACT-JOB-STRUCTURED-2",
        category: "技师运营",
        priority: "medium",
        title: "针对晚场承接偏弱班次，本周补1名可承接点钟技师，目标把流失钟数压降10%。",
      }),
    );
  });

  it("falls back to deterministic bounded synthesis when the CrewAI sidecar files are unavailable", async () => {
    process.env.HETANG_CREWAI_SIDECAR_DIR = "/tmp/htops-missing-crewai-sidecar";
    const { service, runCommandWithTimeout, runScopedQueryAnalysis, buildAnalysisEvidencePack } =
      buildService();

    const result = await service.runCrewAISidecar(buildJob());
    const parsed = JSON.parse(result);
    const rendered = parseHetangAnalysisResult(result);

    expect(result).toContain("证据包");
    expect(result).toContain("诊断信号");
    expect(parsed.summary).toBeTruthy();
    expect(parsed.suggestions.length).toBeGreaterThan(0);
    expect(parsed.actionItems?.length ?? 0).toBeGreaterThan(0);
    expect(parsed.orchestration).toEqual(
      expect.objectContaining({
        version: "v1",
        fallbackStage: "bounded_synthesis",
        stageTrace: expect.arrayContaining([
          expect.objectContaining({
            stage: "bounded_synthesis",
            status: "fallback",
            detail: expect.stringContaining("sidecar_missing"),
          }),
        ]),
      }),
    );
    expect(rendered.markdown).toContain("证据包");
    expect(rendered.markdown).toContain("诊断信号");
    expect(buildAnalysisEvidencePack).toHaveBeenCalledTimes(1);
    expect(runScopedQueryAnalysis).not.toHaveBeenCalled();
    expect(runCommandWithTimeout).not.toHaveBeenCalled();
  });

  it("passes the compact evidence pack into the CrewAI sidecar environment", async () => {
    process.env.HETANG_CREWAI_SIDECAR_DIR = "/tmp/htops-crewai-sidecar";
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync("/tmp/htops-crewai-sidecar", { recursive: true });
    writeFileSync("/tmp/htops-crewai-sidecar/store_review.py", "#!/usr/bin/env python3\n");

    const { service, runCommandWithTimeout, buildAnalysisEvidencePack, buildAnalysisDiagnosticBundle } =
      buildService({
      runCommandWithTimeout: vi.fn(async () => ({
        code: 0,
        stdout: JSON.stringify({
          summary: "crew result",
          markdown: "crew markdown",
          risks: [],
          suggestions: [],
        }),
        stderr: "",
      })),
      });

    const result = await service.runCrewAISidecar(buildJob());
    const parsed = JSON.parse(result);

    expect(parsed.summary).toBe("crew result");
    expect(buildAnalysisEvidencePack).toHaveBeenCalledTimes(1);
    expect(buildAnalysisDiagnosticBundle).toHaveBeenCalledTimes(1);
    expect(runCommandWithTimeout).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({
          HETANG_ANALYSIS_EVIDENCE_JSON: expect.any(String),
          HETANG_ANALYSIS_EVIDENCE_MARKDOWN: expect.stringContaining("证据包"),
          HETANG_ANALYSIS_DIAGNOSTIC_JSON: expect.any(String),
          HETANG_ANALYSIS_ORCHESTRATION_PLAN_JSON: expect.any(String),
        }),
      }),
    );
  });

  it("injects analysis-premium lane model, reasoning and timeout into the sidecar env", async () => {
    process.env.HETANG_CREWAI_SIDECAR_DIR = "/tmp/htops-crewai-sidecar-lane";
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync("/tmp/htops-crewai-sidecar-lane", { recursive: true });
    writeFileSync("/tmp/htops-crewai-sidecar-lane/store_review.py", "#!/usr/bin/env python3\n");

    const { service, runCommandWithTimeout } = buildService({
      config: {
        aiLanes: {
          "analysis-premium": {
            model: "gpt-5.4",
            reasoningMode: "high",
            timeoutMs: 120000,
            responseMode: "json",
            fallbackBehavior: "deterministic",
          },
        },
      },
      runCommandWithTimeout: vi.fn(async () => ({
        code: 0,
        stdout: JSON.stringify({
          summary: "lane result",
          markdown: "lane markdown",
          risks: [],
          suggestions: [],
        }),
        stderr: "",
      })),
    });

    const result = await service.runCrewAISidecar(buildJob());
    const parsed = JSON.parse(result);

    expect(parsed.summary).toBe("lane result");
    expect(runCommandWithTimeout).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        timeoutMs: 120000,
        env: expect.objectContaining({
          CREWAI_MODEL: "gpt-5.4",
          OPENAI_MODEL: "gpt-5.4",
          CREWAI_REASONING_EFFORT: "high",
          CREWAI_TIMEOUT_SECONDS: "120",
        }),
      }),
    );
  });

  it("prefers the repo-local CrewAI sidecar when no explicit directory is configured", async () => {
    delete process.env.HETANG_CREWAI_SIDECAR_DIR;
    delete process.env.OPENCLAW_CREWAI_SIDECAR_DIR;

    const { service, runCommandWithTimeout } = buildService({
      runCommandWithTimeout: vi.fn(async () => ({
        code: 0,
        stdout: JSON.stringify({
          summary: "local crew result",
          markdown: "local crew markdown",
          risks: [],
          suggestions: [],
        }),
        stderr: "",
      })),
    });

    const result = await service.runCrewAISidecar(buildJob());
    const parsed = JSON.parse(result);

    expect(parsed.summary).toBe("local crew result");
    expect(runCommandWithTimeout).toHaveBeenCalledWith(
      expect.arrayContaining([
        path.resolve(process.cwd(), "tools/crewai-sidecar/store_review.py"),
      ]),
      expect.objectContaining({
        cwd: path.resolve(process.cwd(), "tools/crewai-sidecar"),
      }),
    );
  });

  it("records bounded orchestration metadata in the raw result payload", async () => {
    process.env.HETANG_CREWAI_SIDECAR_DIR = "/tmp/htops-crewai-sidecar-with-json";
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync("/tmp/htops-crewai-sidecar-with-json", { recursive: true });
    writeFileSync("/tmp/htops-crewai-sidecar-with-json/store_review.py", "#!/usr/bin/env python3\n");

    const { service } = buildService({
      runCommandWithTimeout: vi.fn(async () => ({
        code: 0,
        stdout: JSON.stringify({
          summary: "crew result",
          markdown: "crew markdown",
          risks: [],
          suggestions: [],
          actionItems: [
            {
              title: "针对沉默会员，今天完成20人回访，目标把回店率提升5个点。",
              category: "会员运营",
              priority: "high",
            },
          ],
        }),
        stderr: "",
      })),
    });

    const result = await service.runCrewAISidecar(buildJob());
    const parsed = JSON.parse(result);

    expect(parsed.orchestration).toEqual(
      expect.objectContaining({
        version: "v1",
        completedStages: expect.arrayContaining([
          "evidence_pack",
          "diagnostic_signals",
          "orchestration_plan",
        ]),
        stageTrace: expect.arrayContaining([
          expect.objectContaining({
            stage: "evidence_pack",
            status: "completed",
            detail: expect.stringContaining("scope=single_store"),
          }),
          expect.objectContaining({
            stage: "diagnostic_signals",
            status: "completed",
            detail: expect.stringContaining("signals=1"),
          }),
          expect.objectContaining({
            stage: "orchestration_plan",
            status: "completed",
            detail: expect.stringContaining("focus="),
          }),
          expect.objectContaining({
            stage: "bounded_synthesis",
            status: "completed",
            detail: expect.stringContaining("crewai_sidecar"),
          }),
          expect.objectContaining({
            stage: "action_items",
            status: "completed",
            detail: expect.stringContaining("structured=1"),
          }),
        ]),
      }),
    );
  });

  it("marks the action-items stage as fallback when bounded synthesis only returns suggestions", async () => {
    process.env.HETANG_CREWAI_SIDECAR_DIR = "/tmp/htops-crewai-sidecar-suggestions-only";
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync("/tmp/htops-crewai-sidecar-suggestions-only", { recursive: true });
    writeFileSync("/tmp/htops-crewai-sidecar-suggestions-only/store_review.py", "#!/usr/bin/env python3\n");

    const { service } = buildService({
      runCommandWithTimeout: vi.fn(async () => ({
        code: 0,
        stdout: JSON.stringify({
          summary: "crew result",
          markdown: "crew markdown",
          risks: [],
          suggestions: ["今天完成20人回访，目标把沉默会员回店率提升5个点。"],
        }),
        stderr: "",
      })),
    });

    const result = await service.runCrewAISidecar(buildJob());
    const parsed = JSON.parse(result);

    expect(parsed.orchestration).toEqual(
      expect.objectContaining({
        version: "v1",
        fallbackStage: "action_items",
        stageTrace: expect.arrayContaining([
          expect.objectContaining({
            stage: "bounded_synthesis",
            status: "completed",
          }),
          expect.objectContaining({
            stage: "action_items",
            status: "fallback",
            detail: expect.stringContaining("derived_from_suggestions=1"),
          }),
        ]),
      }),
    );
  });

  it("runs bounded analysis stages in order", async () => {
    process.env.HETANG_CREWAI_SIDECAR_DIR = "/tmp/htops-crewai-sidecar-stage-order";
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync("/tmp/htops-crewai-sidecar-stage-order", { recursive: true });
    writeFileSync("/tmp/htops-crewai-sidecar-stage-order/store_review.py", "#!/usr/bin/env python3\n");

    const calls: string[] = [];
    const evidencePack: HetangAnalysisEvidencePack = {
      packVersion: "v1",
      scopeType: "single_store",
      orgIds: ["1001"],
      storeName: "一号店",
      timeFrameLabel: "近7天",
      startBizDate: "2026-03-23",
      endBizDate: "2026-03-29",
      question: "一号店近7天经营复盘",
      markdown: "证据包",
      facts: {},
    };
    const { service } = buildService({
      buildAnalysisEvidencePack: vi.fn(async () => {
        calls.push("evidence_pack");
        return evidencePack;
      }),
      buildAnalysisDiagnosticBundle: vi.fn(() => {
        calls.push("diagnostic_signals");
        return {
          version: "v1" as const,
          scopeType: "single_store" as const,
          storeName: "一号店",
          orgIds: ["1001"],
          question: "一号店近7天经营复盘",
          signals: [
            {
              signalId: "point_clock_risk",
              severity: "medium" as const,
              title: "点钟集中风险",
              finding: "当前点钟结构偏高。",
              evidence: ["门店点钟率 32.0%"],
            },
          ],
        };
      }),
      runCommandWithTimeout: vi.fn(async () => {
        calls.push("bounded_synthesis");
        return {
          code: 0,
          stdout: JSON.stringify({
            summary: "crew result",
            markdown: "crew markdown",
            risks: [],
            suggestions: [],
          }),
          stderr: "",
        };
      }),
    });

    await service.runCrewAISidecar(buildJob());

    expect(calls).toEqual(["evidence_pack", "diagnostic_signals", "bounded_synthesis"]);
  });

  it("skips sidecar bounded synthesis when diagnostic signals are empty", async () => {
    process.env.HETANG_CREWAI_SIDECAR_DIR = "/tmp/htops-crewai-sidecar-no-signals";
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync("/tmp/htops-crewai-sidecar-no-signals", { recursive: true });
    writeFileSync("/tmp/htops-crewai-sidecar-no-signals/store_review.py", "#!/usr/bin/env python3\n");

    const {
      service,
      runCommandWithTimeout,
      runScopedQueryAnalysis,
      buildAnalysisDiagnosticBundle,
    } = buildService({
      buildAnalysisDiagnosticBundle: vi.fn(() => ({
        version: "v1" as const,
        scopeType: "single_store" as const,
        storeName: "一号店",
        orgIds: ["1001"],
        question: "一号店近7天经营复盘",
        signals: [],
      })),
      runCommandWithTimeout: vi.fn(async () => ({
        code: 0,
        stdout: "crew result",
        stderr: "",
      })),
    });
    const result = await service.runCrewAISidecar(buildJob());
    const parsed = JSON.parse(result);

    expect(parsed.summary).toBeTruthy();
    expect(parsed.markdown).toContain("证据包");
    expect(parsed.orchestration).toEqual(
      expect.objectContaining({
        version: "v1",
        fallbackStage: "bounded_synthesis",
        stageTrace: expect.arrayContaining([
          expect.objectContaining({
            stage: "bounded_synthesis",
            status: "fallback",
            detail: expect.stringContaining("signals_empty"),
          }),
        ]),
      }),
    );
    expect(buildAnalysisDiagnosticBundle).toHaveBeenCalledTimes(1);
    expect(runScopedQueryAnalysis).not.toHaveBeenCalled();
    expect(runCommandWithTimeout).not.toHaveBeenCalled();
  });

  it("falls back to deterministic bounded synthesis when bounded synthesis returns unstructured sidecar output", async () => {
    process.env.HETANG_CREWAI_SIDECAR_DIR = "/tmp/htops-crewai-sidecar-unstructured";
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync("/tmp/htops-crewai-sidecar-unstructured", { recursive: true });
    writeFileSync("/tmp/htops-crewai-sidecar-unstructured/store_review.py", "#!/usr/bin/env python3\n");

    const { service, runCommandWithTimeout, runScopedQueryAnalysis } = buildService({
      runCommandWithTimeout: vi.fn(async () => ({
        code: 0,
        stdout: "plain text sidecar output without the required json contract",
        stderr: "",
      })),
    });

    const result = await service.runCrewAISidecar(buildJob());
    const parsed = JSON.parse(result);

    expect(parsed.summary).toBeTruthy();
    expect(parsed.suggestions.length).toBeGreaterThan(0);
    expect(parsed.actionItems?.length ?? 0).toBeGreaterThan(0);
    expect(parsed.orchestration).toEqual(
      expect.objectContaining({
        version: "v1",
        fallbackStage: "bounded_synthesis",
        stageTrace: expect.arrayContaining([
          expect.objectContaining({
            stage: "bounded_synthesis",
            status: "fallback",
            detail: expect.stringContaining("sidecar_unstructured"),
          }),
        ]),
      }),
    );
    expect(runCommandWithTimeout).toHaveBeenCalledTimes(1);
    expect(runScopedQueryAnalysis).not.toHaveBeenCalled();
  });

  it("falls back at the diagnostic-signals stage when signal building throws", async () => {
    process.env.HETANG_CREWAI_SIDECAR_DIR = "/tmp/htops-crewai-sidecar-diagnostic-error";
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync("/tmp/htops-crewai-sidecar-diagnostic-error", { recursive: true });
    writeFileSync("/tmp/htops-crewai-sidecar-diagnostic-error/store_review.py", "#!/usr/bin/env python3\n");

    const { service, runCommandWithTimeout, runScopedQueryAnalysis } = buildService({
      buildAnalysisDiagnosticBundle: vi.fn(() => {
        throw new Error("diagnostic rules exploded");
      }),
      runCommandWithTimeout: vi.fn(async () => ({
        code: 0,
        stdout: JSON.stringify({
          summary: "crew result",
          markdown: "crew markdown",
          risks: [],
          suggestions: [],
        }),
        stderr: "",
      })),
    });
    const result = await service.runCrewAISidecar(buildJob());
    const parsed = JSON.parse(result);

    expect(parsed.summary).toBeTruthy();
    expect(parsed.markdown).toContain("证据包");
    expect(parsed.orchestration).toEqual(
      expect.objectContaining({
        version: "v1",
        fallbackStage: "diagnostic_signals",
        stageTrace: expect.arrayContaining([
          expect.objectContaining({
            stage: "diagnostic_signals",
            status: "fallback",
            detail: expect.stringContaining("diagnostic_signals_error"),
          }),
        ]),
      }),
    );
    expect(runCommandWithTimeout).not.toHaveBeenCalled();
    expect(runScopedQueryAnalysis).not.toHaveBeenCalled();
  });
});
