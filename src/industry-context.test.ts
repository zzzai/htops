import { describe, expect, it, vi } from "vitest";

import {
  assembleIndustryContextPayload,
  loadIndustryContextPayload,
  mapIndustryContextToWorldModelObservations,
  toIndustryContextRuntime,
} from "./industry-context.js";
import type { HetangIndustryContextSnapshotRecord } from "./types.js";

function buildSnapshot(
  overrides: Partial<HetangIndustryContextSnapshotRecord> = {},
): HetangIndustryContextSnapshotRecord {
  return {
    snapshotDate: "2026-04-24",
    signalKind: "platform_rule",
    signalKey: "meituan_subsidy_shift",
    title: "平台补贴策略调整",
    summary: "本地生活平台近期更偏向低价心智，价格敏感客决策会更快。",
    detailJson: {
      city: "安阳",
      effect: "price_sensitive_segment",
    },
    truthBoundary: "weak_signal",
    confidence: "medium",
    sourceType: "manual_research",
    sourceLabel: "行业观察日报",
    sourceUri: "https://example.com/industry/meituan-shift",
    applicableModules: ["hq_narrative", "world_model"],
    note: "只用于 HQ 解释和推演辅助",
    rawJson: "{\"source\":\"manual_research\"}",
    updatedAt: "2026-04-24T09:00:00.000Z",
    ...overrides,
  };
}

describe("industry context owner module", () => {
  it("filters snapshots by module and maps them into world model observations", () => {
    const payload = assembleIndustryContextPayload({
      rows: [
        buildSnapshot(),
        buildSnapshot({
          signalKind: "city_consumption_trend",
          signalKey: "anyang_night_consumption_softening",
          title: "城市夜间消费趋缓",
          summary: "工作日夜间消费意愿略弱于上周。",
          applicableModules: ["hq_narrative"],
        }),
      ],
      module: "world_model",
    });

    expect(payload.snapshotDate).toBe("2026-04-24");
    expect(payload.items).toHaveLength(1);
    expect(payload.narrativeLines).toEqual([
      expect.stringContaining("平台补贴策略调整"),
    ]);
    expect(payload.observations).toEqual([
      expect.objectContaining({
        key: "platform_rule:meituan_subsidy_shift",
        summary: expect.stringContaining("平台补贴策略调整"),
        sourceCategory: "industry_signal",
        truthBoundary: "weak_signal",
      }),
    ]);
  });

  it("returns a safe empty payload and exposes direct observation mapping", async () => {
    await expect(
      loadIndustryContextPayload({
        runtime: {
          listIndustryContextSnapshots: async () => [],
        },
        module: "hq_narrative",
      }),
    ).resolves.toEqual({
      snapshotDate: null,
      items: [],
      observations: [],
      narrativeLines: [],
    });

    expect(
      mapIndustryContextToWorldModelObservations([
        buildSnapshot({
          signalKind: "industry_climate",
          signalKey: "foot_bath_demand_resilient",
          title: "行业需求韧性仍在",
          summary: "高频刚需客群仍保持基本盘。",
        }),
      ]),
    ).toEqual([
      expect.objectContaining({
        key: "industry_climate:foot_bath_demand_resilient",
        summary: expect.stringContaining("行业需求韧性仍在"),
      }),
    ]);
  });

  it("adapts a richer snapshot loader to the bounded industry context runtime", async () => {
    const listIndustryContextSnapshots = vi.fn().mockResolvedValue([buildSnapshot()]);

    const payload = await loadIndustryContextPayload({
      runtime: toIndustryContextRuntime({
        listIndustryContextSnapshots: async (params?: {
          snapshotDate?: string;
          signalKinds?: string[];
          limit?: number;
        }) => await listIndustryContextSnapshots(params),
      }),
      snapshotDate: "2026-04-24",
      module: "world_model",
    });

    expect(listIndustryContextSnapshots).toHaveBeenCalledWith({
      snapshotDate: "2026-04-24",
    });
    expect(payload.items).toHaveLength(1);
    expect(payload.observations).toEqual([
      expect.objectContaining({
        key: "platform_rule:meituan_subsidy_shift",
      }),
    ]);
  });
});
