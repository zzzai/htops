import { describe, expect, it } from "vitest";
import { clusterExternalCandidates } from "./cluster.js";

describe("clusterExternalCandidates", () => {
  it("merges two sources for the same pricing action into one event card", () => {
    const clustered = clusterExternalCandidates([
      {
        candidateId: "cand-1",
        sourceId: "luckin-ir",
        title: "瑞幸回应部分饮品价格调整",
        summary: "官方回应。",
        entity: "瑞幸",
        action: "调价",
        object: "部分饮品",
        theme: "pricing-competition",
        publishedAt: "2026-04-03T09:10:00+08:00",
        eventAt: "2026-04-03T08:30:00+08:00",
        tier: "s",
        score: 92,
        normalizedKey: "luckin-adjust-price-1",
      },
      {
        candidateId: "cand-2",
        sourceId: "finance-media",
        title: "媒体跟进：瑞幸饮品价格带变化",
        summary: "多渠道确认。",
        entity: "瑞幸",
        action: "调价",
        object: "部分饮品",
        theme: "pricing-competition",
        publishedAt: "2026-04-03T10:05:00+08:00",
        eventAt: "2026-04-03T08:40:00+08:00",
        tier: "a",
        score: 84,
        normalizedKey: "luckin-adjust-price-2",
      },
    ]);

    expect(clustered).toHaveLength(1);
    expect(clustered[0]).toMatchObject({
      candidateIds: ["cand-1", "cand-2"],
      sourceIds: ["finance-media", "luckin-ir"],
    });
    expect(clustered[0]?.card).toMatchObject({
      entity: "瑞幸",
      action: "调价",
      object: "部分饮品",
      theme: "pricing-competition",
    });
  });

  it("keeps same-entity but different actions split", () => {
    const clustered = clusterExternalCandidates([
      {
        candidateId: "cand-a",
        sourceId: "chain-media",
        title: "海底捞新开校园店",
        summary: "新场景扩店。",
        entity: "海底捞",
        action: "开店",
        object: "校园食堂",
        theme: "chain-brand",
        publishedAt: "2026-04-03T09:00:00+08:00",
        eventAt: "2026-04-03T08:00:00+08:00",
        tier: "a",
        score: 75,
        normalizedKey: "hdl-open-store",
      },
      {
        candidateId: "cand-b",
        sourceId: "chain-media",
        title: "海底捞宣布关闭低效门店",
        summary: "结构调整。",
        entity: "海底捞",
        action: "关店",
        object: "低效门店",
        theme: "chain-brand",
        publishedAt: "2026-04-03T11:00:00+08:00",
        eventAt: "2026-04-03T10:00:00+08:00",
        tier: "a",
        score: 73,
        normalizedKey: "hdl-close-store",
      },
    ]);

    expect(clustered).toHaveLength(2);
    expect(clustered.map((entry) => entry.card.action).sort()).toEqual(["关店", "开店"]);
  });

  it("does not merge candidates with invalid timestamps into a shared unknown bucket", () => {
    const clustered = clusterExternalCandidates([
      {
        candidateId: "cand-x",
        sourceId: "source-a",
        title: "某品牌调价传闻",
        summary: "时间字段损坏。",
        entity: "某品牌",
        action: "调价",
        object: "套餐",
        theme: "pricing-competition",
        publishedAt: "not-a-date",
        tier: "b",
        score: 40,
        normalizedKey: "brand-adjust-price-a",
      },
      {
        candidateId: "cand-y",
        sourceId: "source-b",
        title: "某品牌调价传闻跟进",
        summary: "另一个坏时间样本。",
        entity: "某品牌",
        action: "调价",
        object: "套餐",
        theme: "pricing-competition",
        publishedAt: "also-not-a-date",
        tier: "b",
        score: 38,
        normalizedKey: "brand-adjust-price-b",
      },
    ]);

    expect(clustered).toHaveLength(2);
    expect(clustered.map((entry) => entry.candidateIds)).toEqual([["cand-x"], ["cand-y"]]);
  });
});
