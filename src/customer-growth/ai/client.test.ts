import { afterEach, describe, expect, it, vi } from "vitest";

import { runCustomerGrowthAiJsonTask } from "./client.js";
import { resolveHetangOpsConfig } from "../../config.js";

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
        storeName: "迎宾店",
        rawAliases: ["荷塘悦色迎宾店"],
      },
    ],
    customerGrowthAi: {
      enabled: true,
      baseUrl: "https://customer-growth.example.com/v1",
      apiKey: "growth-secret",
      model: "gpt-5-mini",
      timeoutMs: 3200,
      profileInsight: { enabled: true },
      tagAdvisor: { enabled: true },
      strategyAdvisor: { enabled: true },
      followupSummarizer: { enabled: true },
    },
    ...overrides,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runCustomerGrowthAiJsonTask", () => {
  it("prefers the customer-growth-json lane model and timeout over legacy module config", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                profileNarrative: "lane-driven",
              }),
            },
          },
        ],
      }),
    });
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    vi.stubGlobal("fetch", fetchMock);

    const result = await runCustomerGrowthAiJsonTask<{
      profileNarrative: string;
    }>({
      config: buildConfig({
        aiLanes: {
          "customer-growth-json": {
            baseUrl: "https://lane-growth.example.com/v1",
            apiKey: "lane-secret",
            model: "deepseek-v3-2-251201",
            timeoutMs: 2100,
            responseMode: "json",
            fallbackBehavior: "deterministic",
          },
        },
      }),
      module: "profileInsight",
      systemPrompt: "只输出 JSON",
      userPrompt: "生成画像摘要",
    });

    expect(result).toEqual({
      profileNarrative: "lane-driven",
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://lane-growth.example.com/v1/chat/completions");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      model: "deepseek-v3-2-251201",
    });
    expect(timeoutSpy.mock.calls.some((call) => call[1] === 2100)).toBe(true);
  });

  it("returns parsed structured json when the customer growth ai response is valid", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  profileNarrative: "这位顾客近90天消费稳定，偏晚间到店。",
                }),
              },
            },
          ],
        }),
      }),
    );

    const result = await runCustomerGrowthAiJsonTask<{
      profileNarrative: string;
    }>({
      config: buildConfig(),
      module: "profileInsight",
      systemPrompt: "只输出 JSON",
      userPrompt: "生成画像摘要",
    });

    expect(result).toEqual({
      profileNarrative: "这位顾客近90天消费稳定，偏晚间到店。",
    });
  });

  it("fails closed when the upstream response is not valid json content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: "not-json",
              },
            },
          ],
        }),
      }),
    );

    const result = await runCustomerGrowthAiJsonTask({
      config: buildConfig(),
      module: "strategyAdvisor",
      systemPrompt: "只输出 JSON",
      userPrompt: "生成召回建议",
    });

    expect(result).toBeNull();
  });

  it("skips execution when the selected customer growth ai module is disabled", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await runCustomerGrowthAiJsonTask({
      config: buildConfig({
        customerGrowthAi: {
          enabled: true,
          baseUrl: "https://customer-growth.example.com/v1",
          apiKey: "growth-secret",
          model: "gpt-5-mini",
          timeoutMs: 3200,
          profileInsight: { enabled: false },
          tagAdvisor: { enabled: true },
          strategyAdvisor: { enabled: true },
          followupSummarizer: { enabled: true },
        },
      }),
      module: "profileInsight",
      systemPrompt: "只输出 JSON",
      userPrompt: "生成画像摘要",
    });

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
