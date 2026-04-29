import { describe, expect, it, vi } from "vitest";
import type { HetangExternalEventCard } from "../types.js";
import type { AssembledExternalBriefItem } from "./assemble.js";
import { buildFallbackExternalNarrative, enrichExternalBriefItemNarrative } from "./llm.js";

function buildCard(overrides: Partial<HetangExternalEventCard> = {}): HetangExternalEventCard {
  return {
    cardId: overrides.cardId ?? "card-luckin-price",
    entity: overrides.entity ?? "瑞幸",
    action: overrides.action ?? "调价",
    object: overrides.object ?? "部分饮品",
    theme: overrides.theme ?? "pricing-competition",
    eventAt: overrides.eventAt ?? "2026-04-03T08:30:00+08:00",
    publishedAt: overrides.publishedAt ?? "2026-04-03T09:00:00+08:00",
    sources: overrides.sources ?? [
      { sourceId: "luckin-ir", displayName: "瑞幸官方", tier: "s", url: "https://example.com/ir" },
      { sourceId: "jiemian", displayName: "界面新闻", tier: "a", url: "https://example.com/news" },
    ],
    summary: overrides.summary ?? "多个来源确认瑞幸价格调整动作已经进入执行阶段。",
    score: overrides.score ?? 91,
  };
}

function buildItem(
  overrides: Partial<AssembledExternalBriefItem> = {},
): AssembledExternalBriefItem {
  return {
    cardId: overrides.cardId ?? "card-luckin-price",
    title: overrides.title ?? "瑞幸价格带调整进入执行期",
    entity: overrides.entity ?? "瑞幸",
    theme: overrides.theme ?? "pricing-competition",
    sourceIds: overrides.sourceIds ?? ["luckin-ir", "jiemian"],
    score: overrides.score ?? 91,
    summary: overrides.summary ?? "多个来源确认瑞幸价格调整动作已经进入执行阶段。",
    whyItMatters: overrides.whyItMatters ?? "今天需要复核本地团购价格带和到店转化波动。",
    publishedAt: overrides.publishedAt ?? "2026-04-03T09:00:00+08:00",
    rank: overrides.rank ?? 1,
    bucket: overrides.bucket ?? "chainBrand",
  };
}

describe("buildFallbackExternalNarrative", () => {
  it("builds a rule-based summary and why-it-matters text from the event card", () => {
    expect(
      buildFallbackExternalNarrative({
        item: buildItem(),
        card: buildCard(),
      }),
    ).toEqual({
      summary:
        "瑞幸在 2026-04-03 08:30 对部分饮品发起调价，当前已由瑞幸官方、界面新闻等来源交叉确认，说明这一轮价格动作已经进入可执行观察阶段。",
      whyItMatters:
        "价格带变化会直接影响同城比较和转化，今天需要复核门店团购价格带、主推套餐与到店转化波动。",
    });
  });
});

describe("enrichExternalBriefItemNarrative", () => {
  it("passes lane-resolved llm config through to the client when provided", async () => {
    const llm = {
      expandExternalBriefItem: vi.fn().mockResolvedValue({
        summary: "LLM 摘要",
        whyItMatters: "LLM 影响判断",
      }),
    };

    await enrichExternalBriefItemNarrative({
      item: buildItem(),
      card: buildCard(),
      llm,
      llmConfig: {
        laneId: "cheap-summary",
        model: "doubao-seed-2.0-lite",
        reasoningMode: "off",
        timeoutMs: 5000,
        responseMode: "text",
      },
    });

    expect(llm.expandExternalBriefItem).toHaveBeenCalledWith(
      expect.objectContaining({
        llmConfig: {
          laneId: "cheap-summary",
          model: "doubao-seed-2.0-lite",
          reasoningMode: "off",
          timeoutMs: 5000,
          responseMode: "text",
        },
      }),
    );
  });

  it("only calls the LLM after the item has already been assembled", async () => {
    const llm = {
      expandExternalBriefItem: vi.fn().mockResolvedValue({
        summary: "LLM 摘要",
        whyItMatters: "LLM 影响判断",
      }),
    };

    const result = await enrichExternalBriefItemNarrative({
      item: buildItem(),
      card: buildCard(),
      llm,
    });

    expect(llm.expandExternalBriefItem).toHaveBeenCalledWith(
      expect.objectContaining({
        rank: 1,
        bucket: "chainBrand",
        title: "瑞幸价格带调整进入执行期",
      }),
    );
    expect(result.summary).toBe("LLM 摘要");
    expect(result.whyItMatters).toBe("LLM 影响判断");
    expect(result.usedLlm).toBe(true);
  });

  it("falls back to the rule-based narrative when the LLM returns empty content", async () => {
    const llm = {
      expandExternalBriefItem: vi.fn().mockResolvedValue({
        summary: "   ",
        whyItMatters: "",
      }),
    };

    const result = await enrichExternalBriefItemNarrative({
      item: buildItem(),
      card: buildCard(),
      llm,
    });

    expect(result).toMatchObject({
      summary:
        "瑞幸在 2026-04-03 08:30 对部分饮品发起调价，当前已由瑞幸官方、界面新闻等来源交叉确认，说明这一轮价格动作已经进入可执行观察阶段。",
      whyItMatters:
        "价格带变化会直接影响同城比较和转化，今天需要复核门店团购价格带、主推套餐与到店转化波动。",
      usedLlm: false,
    });
  });
});
