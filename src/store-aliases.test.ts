import { describe, expect, it } from "vitest";
import { resolveHetangOpsConfig } from "./config.js";
import { resolveMatchedStores, resolveStoreAliasCandidates } from "./store-aliases.js";

function buildConfig() {
  return resolveHetangOpsConfig({
    api: {
      appKey: "demo-app-key",
      appSecret: "demo-app-secret",
    },
    database: {
      url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
    },
    stores: [
      { orgId: "1001", storeName: "荷塘悦色义乌店", rawAliases: ["义乌店"] },
      { orgId: "1002", storeName: "荷塘悦色园中园店", rawAliases: ["园中园店"] },
    ],
  });
}

describe("store aliases", () => {
  it("matches safe shortened store aliases without requiring config to list every variant", () => {
    const config = buildConfig();

    expect(resolveStoreAliasCandidates(config.stores[1] ?? { storeName: "", rawAliases: [] })).toContain(
      "园中园",
    );
    expect(resolveMatchedStores(config, "园中园昨天客流量多少")).toMatchObject([
      {
        orgId: "1002",
        storeName: "荷塘悦色园中园店",
      },
    ]);
  });

  it("keeps ambiguous two-character store cores out of automatic shortened aliases", () => {
    const config = buildConfig();

    expect(resolveStoreAliasCandidates(config.stores[0] ?? { storeName: "", rawAliases: [] })).not.toContain(
      "义乌",
    );
  });
});
