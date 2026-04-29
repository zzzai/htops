import { describe, expect, it } from "vitest";
import { assembleTopExternalBrief } from "./assemble.js";

type TestEvent = {
  cardId: string;
  title: string;
  entity: string;
  theme: string;
  sourceIds: string[];
  score: number;
  summary: string;
  whyItMatters: string;
  publishedAt: string;
};

function buildEvent(
  overrides: Partial<TestEvent> & Pick<TestEvent, "cardId" | "title">,
): TestEvent {
  return {
    cardId: overrides.cardId,
    title: overrides.title,
    entity: overrides.entity ?? overrides.title,
    theme: overrides.theme ?? "general-hot-topic",
    sourceIds: overrides.sourceIds ?? [overrides.cardId],
    score: overrides.score ?? 80,
    summary: overrides.summary ?? `${overrides.title} 摘要`,
    whyItMatters: overrides.whyItMatters ?? `${overrides.title} 的经营影响`,
    publishedAt: overrides.publishedAt ?? "2026-04-03T09:00:00+08:00",
  };
}

describe("assembleTopExternalBrief", () => {
  it("builds the target 4/3/3 composition", () => {
    const events: TestEvent[] = [
      buildEvent({ cardId: "g1", title: "热点1", theme: "general-hot-topic", score: 95 }),
      buildEvent({ cardId: "g2", title: "热点2", theme: "general-hot-topic", score: 94 }),
      buildEvent({ cardId: "g3", title: "热点3", theme: "general-hot-topic", score: 93 }),
      buildEvent({ cardId: "g4", title: "热点4", theme: "general-hot-topic", score: 92 }),
      buildEvent({ cardId: "c1", title: "连锁1", theme: "chain-brand", score: 91 }),
      buildEvent({ cardId: "c2", title: "连锁2", theme: "chain-brand", score: 90 }),
      buildEvent({ cardId: "p1", title: "价格1", theme: "pricing-competition", score: 89 }),
      buildEvent({ cardId: "s1", title: "战略1", theme: "strategy-organization", score: 88 }),
      buildEvent({ cardId: "s2", title: "平台1", theme: "platform-rule", score: 87 }),
      buildEvent({ cardId: "s3", title: "战略2", theme: "strategy-organization", score: 86 }),
    ];

    const brief = assembleTopExternalBrief(events);

    expect(brief.items).toHaveLength(10);
    expect(brief.metrics.countsByBucket).toEqual({
      generalHotTopic: 4,
      chainBrand: 3,
      strategyPlatform: 3,
    });
  });

  it("caps the same source at two selected items", () => {
    const brief = assembleTopExternalBrief([
      buildEvent({ cardId: "a1", title: "同源1", sourceIds: ["same-source"], score: 95 }),
      buildEvent({ cardId: "a2", title: "同源2", sourceIds: ["same-source"], score: 94 }),
      buildEvent({ cardId: "a3", title: "同源3", sourceIds: ["same-source"], score: 93 }),
      buildEvent({ cardId: "b1", title: "其他1", sourceIds: ["other-1"], score: 92 }),
      buildEvent({ cardId: "b2", title: "其他2", sourceIds: ["other-2"], score: 91 }),
      buildEvent({ cardId: "b3", title: "其他3", sourceIds: ["other-3"], score: 90 }),
      buildEvent({ cardId: "b4", title: "其他4", sourceIds: ["other-4"], score: 89 }),
      buildEvent({ cardId: "b5", title: "其他5", sourceIds: ["other-5"], score: 88 }),
      buildEvent({ cardId: "b6", title: "其他6", sourceIds: ["other-6"], score: 87 }),
      buildEvent({ cardId: "b7", title: "其他7", sourceIds: ["other-7"], score: 86 }),
    ]);

    const selectedFromSameSource = brief.items.filter((item) =>
      item.sourceIds.includes("same-source"),
    );
    expect(selectedFromSameSource).toHaveLength(2);
  });

  it("caps the same entity at two selected items", () => {
    const brief = assembleTopExternalBrief([
      buildEvent({ cardId: "a1", title: "同实体1", entity: "瑞幸", score: 95 }),
      buildEvent({ cardId: "a2", title: "同实体2", entity: "瑞幸", score: 94 }),
      buildEvent({ cardId: "a3", title: "同实体3", entity: "瑞幸", score: 93 }),
      buildEvent({ cardId: "b1", title: "其他1", entity: "海底捞", score: 92 }),
      buildEvent({
        cardId: "b2",
        title: "其他2",
        entity: "美团",
        score: 91,
        theme: "platform-rule",
      }),
      buildEvent({ cardId: "b3", title: "其他3", entity: "行业", score: 90 }),
      buildEvent({ cardId: "b4", title: "其他4", entity: "政策", score: 89 }),
      buildEvent({
        cardId: "b5",
        title: "其他5",
        entity: "连锁A",
        score: 88,
        theme: "chain-brand",
      }),
      buildEvent({
        cardId: "b6",
        title: "其他6",
        entity: "连锁B",
        score: 87,
        theme: "chain-brand",
      }),
      buildEvent({
        cardId: "b7",
        title: "其他7",
        entity: "组织A",
        score: 86,
        theme: "strategy-organization",
      }),
    ]);

    const selectedForEntity = brief.items.filter((item) => item.entity === "瑞幸");
    expect(selectedForEntity).toHaveLength(2);
  });

  it("under-fills the brief when quality is insufficient", () => {
    const brief = assembleTopExternalBrief([
      buildEvent({ cardId: "l1", title: "低质1", score: 49 }),
      buildEvent({ cardId: "l2", title: "低质2", score: 48, theme: "chain-brand" }),
      buildEvent({ cardId: "l3", title: "低质3", score: 47, theme: "strategy-organization" }),
      buildEvent({ cardId: "h1", title: "高质1", score: 82 }),
      buildEvent({ cardId: "h2", title: "高质2", score: 81, theme: "chain-brand" }),
    ]);

    expect(brief.items).toHaveLength(2);
    expect(brief.metrics.skippedLowQuality).toBe(3);
  });
});
