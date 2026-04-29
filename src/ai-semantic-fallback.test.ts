import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveAiSemanticFallback } from "./ai-semantic-fallback.js";
import { resolveHetangOpsConfig } from "./config.js";

function buildConfig(overrides: Record<string, unknown> = {}) {
  return resolveHetangOpsConfig({
    api: {
      appSecret: "demo-app-secret",
    },
    database: {
      url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
    },
    stores: [
      {
        orgId: "1001",
        storeName: "义乌店",
        rawAliases: ["荷塘悦色义乌店"],
      },
      {
        orgId: "1005",
        storeName: "迎宾店",
        rawAliases: ["荷塘悦色迎宾店"],
      },
    ],
    semanticFallback: {
      enabled: true,
      baseUrl: "https://semantic.example.com/v1",
      apiKey: "semantic-secret",
      model: "gpt-4.1-mini",
      timeoutMs: 3200,
      autoAcceptConfidence: 0.85,
      clarifyConfidence: 0.7,
    },
    ...overrides,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveAiSemanticFallback", () => {
  it("prefers semantic-fallback lane model and timeout when configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                intent_kind: "metric",
                confidence: 0.93,
                store_names: ["义乌店"],
                time_mode: "yesterday",
                metric_hints: ["营收"],
              }),
            },
          },
        ],
      }),
    });
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveAiSemanticFallback({
      config: buildConfig({
        aiLanes: {
          "semantic-fallback": {
            baseUrl: "https://semantic-lane.example.com/v1",
            apiKey: "lane-secret",
            model: "deepseek-v3-2-251201",
            timeoutMs: 2100,
            responseMode: "json",
            fallbackBehavior: "deterministic",
          },
        },
      }),
      text: "这个店昨天营收怎么样",
      now: new Date("2026-04-05T10:00:00+08:00"),
    });

    expect(result?.intent).toMatchObject({
      kind: "metric",
      explicitOrgIds: ["1001"],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://semantic-lane.example.com/v1/chat/completions");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      model: "deepseek-v3-2-251201",
    });
    expect(timeoutSpy.mock.calls.some((call) => call[1] === 2100)).toBe(true);
  });

  it("builds a deterministic intent from a high-confidence structured fallback response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  intent_kind: "metric",
                  confidence: 0.93,
                  store_names: ["义乌店"],
                  time_mode: "yesterday",
                  metric_hints: ["营收"],
                }),
              },
            },
          ],
        }),
      }),
    );

    const result = await resolveAiSemanticFallback({
      config: buildConfig(),
      text: "这个店昨天营收怎么样",
      now: new Date("2026-04-05T10:00:00+08:00"),
    });

    expect(result?.clarificationText).toBeUndefined();
    expect(result?.intent).toMatchObject({
      kind: "metric",
      explicitOrgIds: ["1001"],
      metrics: [{ key: "serviceRevenue", label: "服务营收" }],
      timeFrame: {
        kind: "single",
        bizDate: "2026-04-04",
      },
    });
  });

  it("returns a clarification when the model says the scope is still ambiguous", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  intent_kind: "unknown",
                  confidence: 0.72,
                  needs_clarification: true,
                  clarification_reason: "missing_store_scope",
                }),
              },
            },
          ],
        }),
      }),
    );

    const result = await resolveAiSemanticFallback({
      config: buildConfig(),
      text: "最近最危险的是不是这家",
      now: new Date("2026-04-05T10:00:00+08:00"),
    });

    expect(result?.intent).toBeUndefined();
    expect(result?.clarificationText).toContain("门店范围");
  });

  it("drops low-confidence fallback outputs instead of forcing a guess", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  intent_kind: "metric",
                  confidence: 0.52,
                  store_names: ["义乌店"],
                  time_mode: "yesterday",
                  metric_hints: ["营收"],
                }),
              },
            },
          ],
        }),
      }),
    );

    const result = await resolveAiSemanticFallback({
      config: buildConfig(),
      text: "这个店昨天营收怎么样",
      now: new Date("2026-04-05T10:00:00+08:00"),
    });

    expect(result).toBeNull();
  });

  it("clarifies ambiguous cash phrasing instead of auto-accepting a guessed metric", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  intent_kind: "metric",
                  confidence: 0.88,
                  store_names: ["义乌店"],
                  time_mode: "yesterday",
                  metric_hints: ["盘收", "储值盘点收款", "储值"],
                }),
              },
            },
          ],
        }),
      }),
    );

    const result = await resolveAiSemanticFallback({
      config: buildConfig(),
      text: "义乌店昨天盘里收了多少",
      now: new Date("2026-04-05T10:00:00+08:00"),
    });

    expect(result?.intent).toBeUndefined();
    expect(result?.clarificationText).toContain("经营指标还不够清楚");
  });

  it.each([
    "义乌店昨天收了多少",
    "义乌店今天搞了多少",
    "义乌店这几天做了多少",
  ])("clarifies ambiguous money colloquial phrasing: %s", async (text) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  intent_kind: "metric",
                  confidence: 0.9,
                  store_names: ["义乌店"],
                  time_mode: "yesterday",
                  metric_hints: ["营收"],
                }),
              },
            },
          ],
        }),
      }),
    );

    const result = await resolveAiSemanticFallback({
      config: buildConfig(),
      text,
      now: new Date("2026-04-05T10:00:00+08:00"),
    });

    expect(result?.intent).toBeUndefined();
    expect(result?.clarificationText).toContain("经营指标还不够清楚");
  });

  it("clarifies when fallback metric hints cannot be resolved into a local metric", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  intent_kind: "metric",
                  confidence: 0.93,
                  store_names: ["义乌店"],
                  time_mode: "yesterday",
                  metric_hints: ["盘效"],
                }),
              },
            },
          ],
        }),
      }),
    );

    const result = await resolveAiSemanticFallback({
      config: buildConfig(),
      text: "义乌店昨天这个经营指标多少",
      now: new Date("2026-04-05T10:00:00+08:00"),
    });

    expect(result?.intent).toBeUndefined();
    expect(result?.clarificationText).toContain("经营指标还不够清楚");
  });
});
