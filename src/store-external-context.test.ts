import { describe, expect, it } from "vitest";

import {
  assembleStoreExternalContextForAi,
  loadStoreExternalContextForAi,
} from "./store-external-context.js";
import type { HetangStoreExternalContextEntry } from "./types.js";

function buildEntry(
  overrides: Partial<HetangStoreExternalContextEntry>,
): HetangStoreExternalContextEntry {
  return {
    orgId: "1001",
    snapshotDate: "2026-04-18",
    contextKind: "estimated_market_context",
    metricKey: "delivery_store_count_3km",
    valueText: "662",
    valueNum: 662,
    valueJson: undefined,
    unit: "count",
    truthLevel: "estimated",
    confidence: "medium",
    sourceType: "third_party_pdf",
    sourceLabel: "查外卖.pdf",
    sourceUri: "mdshuju/查外卖.pdf",
    applicableModules: ["store_advice", "customer_growth_ai"],
    notForScoring: true,
    note: undefined,
    rawJson: "{}",
    updatedAt: "2026-04-18T10:00:00.000Z",
    ...overrides,
  };
}

describe("store external context ai assembler", () => {
  it("groups confirmed and estimated facts while keeping research notes separate", () => {
    const payload = assembleStoreExternalContextForAi({
      orgId: "1001",
      entries: [
        buildEntry({
          contextKind: "store_business_profile",
          metricKey: "store_format",
          valueText: "cinema_foot_bath",
          valueNum: undefined,
          truthLevel: "confirmed",
          confidence: "high",
          sourceType: "store_page_screenshot",
          notForScoring: false,
        }),
        buildEntry({
          metricKey: "delivery_store_count_3km",
          valueText: "662",
          valueNum: 662,
        }),
        buildEntry({
          contextKind: "research_note",
          metricKey: "seasonal_nightlife_pattern",
          valueText: "安阳属中国北方城市，当前季节夜晚撸串、喝酒、饭后休闲需求偏强",
          valueNum: undefined,
          truthLevel: "research_note",
          note: "只用于经营解释",
        }),
      ],
      module: "customer_growth_ai",
    });

    expect(payload).toMatchObject({
      orgId: "1001",
      snapshotDate: "2026-04-18",
      confirmed: {
        store_format: "cinema_foot_bath",
      },
      estimatedMarketContext: {
        delivery_store_count_3km: 662,
      },
      researchNotes: [
        {
          metricKey: "seasonal_nightlife_pattern",
          value: "安阳属中国北方城市，当前季节夜晚撸串、喝酒、饭后休闲需求偏强",
          note: "只用于经营解释",
          notForScoring: true,
        },
      ],
    });
    expect(payload.provenance.confirmed.store_format).toMatchObject({
      truthLevel: "confirmed",
      confidence: "high",
      sourceType: "store_page_screenshot",
      notForScoring: false,
    });
    expect(payload.provenance.estimatedMarketContext.delivery_store_count_3km).toMatchObject({
      truthLevel: "estimated",
      confidence: "medium",
      sourceType: "third_party_pdf",
      notForScoring: true,
    });
  });

  it("filters rows by applicable module and returns a safe empty payload when no rows exist", async () => {
    const payload = await loadStoreExternalContextForAi({
      runtime: {
        listStoreExternalContextEntries: async () => [
          buildEntry({
            metricKey: "delivery_store_count_3km",
            applicableModules: ["store_advice"],
          }),
        ],
      },
      orgId: "1001",
      module: "customer_growth_ai",
    });

    expect(payload).toEqual({
      orgId: "1001",
      snapshotDate: null,
      confirmed: {},
      estimatedMarketContext: {},
      researchNotes: [],
      provenance: {
        confirmed: {},
        estimatedMarketContext: {},
      },
    });
  });
});
