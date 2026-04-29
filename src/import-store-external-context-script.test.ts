import { describe, expect, it, vi } from "vitest";

import { importStoreExternalContextSnapshot } from "./import-store-external-context-script.js";

describe("importStoreExternalContextSnapshot", () => {
  it("imports a checked-in store external context snapshot into the store", async () => {
    const upsertStoreExternalContextEntry = vi.fn().mockResolvedValue(undefined);
    const logs: string[] = [];

    const result = await importStoreExternalContextSnapshot({
      store: {
        upsertStoreExternalContextEntry,
      } as never,
      filePath: "data/store-external-context/yingbin-2026-04-18.json",
      readFile: async () =>
        JSON.stringify({
          orgId: "1001",
          storeName: "迎宾店",
          snapshotDate: "2026-04-18",
          entries: [
            {
              orgId: "1001",
              snapshotDate: "2026-04-18",
              contextKind: "store_business_profile",
              metricKey: "service_hours",
              valueText: "11:30-次日02:00",
              truthLevel: "confirmed",
              confidence: "high",
              sourceType: "store_page_screenshot",
              sourceLabel: "门店页截图",
              applicableModules: ["store_advice", "analysis_explanation"],
              notForScoring: false,
              rawJson: "{\"valueText\":\"11:30-次日02:00\"}",
              updatedAt: "2026-04-18T10:00:00.000Z",
            },
            {
              orgId: "1001",
              snapshotDate: "2026-04-18",
              contextKind: "research_note",
              metricKey: "store_business_scene_inference",
              valueText: "大店 + 晚场 + 多人局 + 商务/社区混合型",
              truthLevel: "research_note",
              confidence: "medium",
              sourceType: "composite_research_judgement",
              sourceLabel: "综合研判",
              applicableModules: ["store_advice"],
              notForScoring: true,
              note: "仅用于经营解释",
              rawJson: "{\"valueText\":\"大店 + 晚场 + 多人局 + 商务/社区混合型\"}",
              updatedAt: "2026-04-18T10:04:00.000Z",
            },
          ],
        }),
      log: (line) => logs.push(line),
    });

    expect(upsertStoreExternalContextEntry).toHaveBeenCalledTimes(2);
    expect(upsertStoreExternalContextEntry).toHaveBeenNthCalledWith(1, {
      orgId: "1001",
      snapshotDate: "2026-04-18",
      contextKind: "store_business_profile",
      metricKey: "service_hours",
      valueText: "11:30-次日02:00",
      truthLevel: "confirmed",
      confidence: "high",
      sourceType: "store_page_screenshot",
      sourceLabel: "门店页截图",
      applicableModules: ["store_advice", "analysis_explanation"],
      notForScoring: false,
      rawJson: "{\"valueText\":\"11:30-次日02:00\"}",
      updatedAt: "2026-04-18T10:00:00.000Z",
    });
    expect(result).toEqual({
      orgId: "1001",
      snapshotDate: "2026-04-18",
      importedCount: 2,
    });
    expect(logs).toContain(
      "Imported 2 store external context entries for org=1001 snapshot=2026-04-18 from data/store-external-context/yingbin-2026-04-18.json",
    );
  });
});
