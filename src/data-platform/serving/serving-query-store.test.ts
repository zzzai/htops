import { describe, expect, it, vi } from "vitest";
import { createServingQueryStore } from "./serving-query-store.js";

describe("createServingQueryStore", () => {
  it("reads the latest serving version and executes compiled SQL through the injected query interface", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ serving_version: "serving-v2" }] })
      .mockResolvedValueOnce({ rows: [{ org_id: "1001" }] });

    const store = createServingQueryStore({ query });

    await expect(store.getCurrentServingVersion()).resolves.toBe("serving-v2");
    await expect(store.executeCompiledServingQuery("select 1", [])).resolves.toEqual([
      { org_id: "1001" },
    ]);
  });
});
