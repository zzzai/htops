import { describe, expect, it } from "vitest";
import { resolveHetangOpsConfig } from "./config.js";
import { resolveSemanticFrontdoorClassification } from "./semantic-frontdoor-classifier.js";

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
      { orgId: "1001", storeName: "义乌店", rawAliases: ["义乌"] },
      { orgId: "1002", storeName: "迎宾店", rawAliases: ["迎宾"] },
    ],
  });
}

describe("resolveSemanticFrontdoorClassification", () => {
  const config = buildConfig();

  it("routes semantic asset design asks away from store-data clarification", () => {
    const drafts = resolveSemanticFrontdoorClassification({
      config,
      text: "客户标签 osi草案",
    });
    const usage = resolveSemanticFrontdoorClassification({
      config,
      text: "客户标签怎么用于会员唤回",
    });

    expect(drafts).toMatchObject({
      lane: "semantic_asset_design",
      domain: "customer",
      requiresStore: false,
      requiresTime: false,
      requiresMetric: false,
      confidence: "high",
    });
    expect(usage).toMatchObject({
      lane: "semantic_asset_design",
      domain: "customer",
      requiresStore: false,
    });
  });

  it("routes methodology and world-model asks away from store-data clarification", () => {
    expect(
      resolveSemanticFrontdoorClassification({
        config,
        text: "门店的世界模型 如何搭建",
      }),
    ).toMatchObject({
      lane: "methodology_concept",
      domain: "store",
      requiresStore: false,
    });

    expect(
      resolveSemanticFrontdoorClassification({
        config,
        text: "门店的 ai物理模型，如何定义",
      }),
    ).toMatchObject({
      lane: "methodology_concept",
      domain: "store",
      requiresStore: false,
    });
  });

  it("routes concrete store data asks into the store data lane with slot requirements", () => {
    expect(
      resolveSemanticFrontdoorClassification({
        config,
        text: "义乌店昨天营收多少",
      }),
    ).toMatchObject({
      lane: "store_data_query",
      domain: "store",
      requiresStore: true,
      requiresTime: true,
      requiresMetric: true,
      confidence: "high",
    });

    expect(
      resolveSemanticFrontdoorClassification({
        config,
        text: "义乌店高余额沉睡会员名单",
      }),
    ).toMatchObject({
      lane: "store_data_query",
      domain: "customer",
      requiresStore: true,
      confidence: "high",
    });
  });

  it("routes non-store knowledge and market asks into explicit non-data lanes", () => {
    expect(
      resolveSemanticFrontdoorClassification({
        config,
        text: "用华与华理论做品牌策划全案",
      }),
    ).toMatchObject({
      lane: "brand_marketing_plan",
      domain: "brand",
      requiresStore: false,
    });

    expect(
      resolveSemanticFrontdoorClassification({
        config,
        text: "这本营销书如何用于店长管理",
      }),
    ).toMatchObject({
      lane: "book_knowledge_qa",
      domain: "marketing",
      requiresStore: false,
    });

    expect(
      resolveSemanticFrontdoorClassification({
        config,
        text: "帮我做长风拨筋这个品牌的竞品分析",
      }),
    ).toMatchObject({
      lane: "external_research",
      domain: "brand",
      requiresStore: false,
    });
  });
});
