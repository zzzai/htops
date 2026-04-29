import { describe, expect, it, vi } from "vitest";

import { HetangOpsStore } from "./store.js";

describe("HetangOpsStore owner getters", () => {
  it("exposes the serving publication owner getter for sync-side publication flows", () => {
    const pool = {
      query: vi.fn(),
    };
    const store = new HetangOpsStore({
      pool: pool as never,
      stores: [{ orgId: "1001", storeName: "一号店", rawAliases: [] }],
    });

    expect(
      typeof (store as unknown as { getServingPublicationStore?: unknown }).getServingPublicationStore,
    ).toBe("function");
  });
});
