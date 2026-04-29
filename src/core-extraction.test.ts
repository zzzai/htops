import { describe, expect, it } from "vitest";

import { resolveHetangOpsConfig } from "./config.js";
import {
  normalizeHetangSemanticText,
  resolveHetangQuerySemanticContext,
} from "./query-semantics.js";
import { resolveHetangQueryIntent } from "./query-intent.js";

const config = resolveHetangOpsConfig({
  api: {
    appKey: "demo-app-key",
    appSecret: "demo-app-secret",
  },
  database: {
    url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
  },
  timeZone: "Asia/Shanghai",
  sync: {
    enabled: false,
    businessDayCutoffLocalTime: "03:00",
  },
  reporting: {
    enabled: false,
  },
  stores: [
    {
      orgId: "store-yb",
      storeName: "迎宾店",
      rawAliases: ["迎宾"],
      isActive: true,
    },
  ],
});

describe("hetang ops standalone semantic core", () => {
  it("resolves semantic context from the standalone runtime modules", () => {
    expect(normalizeHetangSemanticText("迎宾店盘子稳不稳")).toContain("经营复盘");

    const context = resolveHetangQuerySemanticContext({
      config,
      text: "迎宾店盘子稳不稳",
    });

    expect(context.explicitOrgIds).toEqual(["store-yb"]);
    expect(context.semanticSlots.object).toBe("store");
  });

  it("parses query intent from the standalone runtime modules", () => {
    const intent = resolveHetangQueryIntent({
      config,
      text: "迎宾店近30天盘子稳不稳",
      now: new Date("2026-04-08T04:00:00.000Z"),
    });

    expect(intent).not.toBeNull();
    expect(intent?.kind).toBe("report");
    expect(intent?.timeFrame).toMatchObject({
      kind: "range",
      startBizDate: "2026-03-09",
      endBizDate: "2026-04-07",
      days: 30,
    });
  });
});
