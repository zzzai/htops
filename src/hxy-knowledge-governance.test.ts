import { describe, expect, test } from "vitest";
import {
  buildHxyKnowledgeGovernanceReport,
  classifyHxyClaimTheme,
  detectHxyClaimConflicts,
} from "./hxy-knowledge-governance.js";
import type { HxyKnowledgeClaim } from "./hxy-knowledge-extractor.js";

function claim(overrides: Partial<HxyKnowledgeClaim> & Pick<HxyKnowledgeClaim, "claim_id" | "claim_type" | "claim">): HxyKnowledgeClaim {
  return {
    stage: "preparation",
    status: "current_candidate",
    confidence: 0.75,
    evidence_ids: [`evidence-${overrides.claim_id}`],
    conflict_claim_ids: [],
    needs_validation: true,
    ...overrides,
  };
}

describe("hxy knowledge governance", () => {
  test("classifies strategic claim themes", () => {
    expect(classifyHxyClaimTheme("荷小悦定位社区泡脚按摩小店")).toBe("community_store_positioning");
    expect(classifyHxyClaimTheme("荷小悦是银发健康科技平台")).toBe("silver_health_platform_positioning");
    expect(classifyHxyClaimTheme("目标客群包含银发老人和社区家庭")).toBe("customer_segment");
    expect(classifyHxyClaimTheme("主推款60分钟泡脚+按摩+离店护理包，价格128元")).toBe("product_price_model");
    expect(classifyHxyClaimTheme("投资规模约50万元，目标回本周期8个月")).toBe("store_financial_model");
  });

  test("detects positioning conflicts between store model and platform narrative", () => {
    const conflicts = detectHxyClaimConflicts([
      claim({
        claim_id: "c1",
        claim_type: "brand_positioning",
        claim: "荷小悦定位社区泡脚按摩小店，强调社区小店和私域复购。",
      }),
      claim({
        claim_id: "c2",
        claim_type: "brand_positioning",
        claim: "荷小悦是银发健康科技平台，未来连接养老生态。",
      }),
    ]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      conflict_type: "positioning_stage_conflict",
      primary_claim_id: "c1",
      conflicting_claim_id: "c2",
    });
  });

  test("collapses repeated positioning conflicts into representative review items", () => {
    const conflicts = detectHxyClaimConflicts([
      claim({
        claim_id: "c1",
        claim_type: "brand_positioning",
        claim: "荷小悦定位社区泡脚按摩小店，强调社区小店和私域复购。",
      }),
      claim({
        claim_id: "c2",
        claim_type: "brand_positioning",
        claim: "荷小悦定位社区养生小店，强调社区信任。",
      }),
      claim({
        claim_id: "c3",
        claim_type: "brand_positioning",
        claim: "荷小悦是银发健康科技平台，未来连接养老生态。",
      }),
      claim({
        claim_id: "c4",
        claim_type: "brand_positioning",
        claim: "荷小悦未来成为银发基建平台。",
      }),
    ]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      conflict_type: "positioning_stage_conflict",
      primary_claim_id: "c1",
      conflicting_claim_id: "c3",
    });
  });

  test("builds governance report with recommended current candidates", () => {
    const report = buildHxyKnowledgeGovernanceReport([
      claim({
        claim_id: "c1",
        claim_type: "brand_positioning",
        claim: "荷小悦定位社区泡脚按摩小店，强调社区小店和私域复购。",
        confidence: 0.8,
      }),
      claim({
        claim_id: "c2",
        claim_type: "brand_positioning",
        claim: "荷小悦是银发健康科技平台，未来连接养老生态。",
        confidence: 0.7,
      }),
      claim({
        claim_id: "c3",
        claim_type: "financial_assumption",
        claim: "投资规模约50万元，目标回本周期8个月。",
        confidence: 0.72,
      }),
    ]);

    expect(report.theme_groups.community_store_positioning.claim_count).toBe(1);
    expect(report.theme_groups.silver_health_platform_positioning.claim_count).toBe(1);
    expect(report.recommended_current_candidates.map((item) => item.claim_id)).toContain("c1");
    expect(report.conflicts).toHaveLength(1);
    expect(report.summary.needs_human_review_count).toBeGreaterThan(0);
  });

  test("does not recommend competitor matrix or financing noise as current brand candidates", () => {
    const report = buildHxyKnowledgeGovernanceReport([
      claim({
        claim_id: "noise-community",
        claim_type: "brand_positioning",
        claim: "05 竞品差异化矩阵 荷小悦小店 vs 市场主流竞争对手 差异维度 旗舰大店模型（奈晚·谷小推等） 荷小悦小店模型 优劣势。",
        confidence: 0.95,
      }),
      claim({
        claim_id: "good-community",
        claim_type: "brand_positioning",
        claim: "荷小悦定位社区泡脚按摩小店，以社区小店、私域复购和真实有效为当前主定位。",
        confidence: 0.8,
      }),
      claim({
        claim_id: "noise-brand",
        claim_type: "brand_positioning",
        claim: "IPO 估值 500 亿，C 轮融资建设 AI 系统 V5.0。",
        confidence: 0.99,
      }),
      claim({
        claim_id: "good-brand",
        claim_type: "brand_asset",
        claim: "品牌名荷小悦，Slogan：草本真现煮，按出真功夫。",
        confidence: 0.78,
      }),
      claim({
        claim_id: "noise-product",
        claim_type: "financial_assumption",
        claim: "+-----------------+-----------------+ 属性维度 | 对应消费者需求 | 荷小悦产品回应 | 差异化竞争点 |",
        confidence: 0.9,
      }),
      claim({
        claim_id: "good-product",
        claim_type: "product_service",
        claim: "主推款60分钟现煮草本泡脚+按摩+离店护理包，价格128元。",
        confidence: 0.76,
      }),
    ]);

    const selected = new Set(report.recommended_current_candidates.map((candidate) => candidate.claim_id));
    expect(selected).toContain("good-community");
    expect(selected).toContain("good-brand");
    expect(selected).toContain("good-product");
    expect(selected).not.toContain("noise-community");
    expect(selected).not.toContain("noise-brand");
    expect(selected).not.toContain("noise-product");
  });

  test("requires theme-specific evidence before recommending current candidates", () => {
    const report = buildHxyKnowledgeGovernanceReport([
      claim({
        claim_id: "weak-ai",
        claim_type: "product_service",
        claim: "账、税务申报、供应商 Portal、全网流水、B 端企业客户。",
        confidence: 0.95,
      }),
      claim({
        claim_id: "good-ai",
        claim_type: "product_service",
        claim: "AI 诊断结果自动生成调理方案，包含到店服务、居家护理、泡脚包配方和饮食建议。",
        confidence: 0.74,
      }),
      claim({
        claim_id: "weak-finance",
        claim_type: "financial_assumption",
        claim: "平安集团可能收购，估值 50 亿。",
        confidence: 0.95,
      }),
      claim({
        claim_id: "good-finance",
        claim_type: "financial_assumption",
        claim: "单店投资50万元，月净利润6.4万元，目标回本周期8个月。",
        confidence: 0.7,
      }),
    ]);

    const selected = new Set(report.recommended_current_candidates.map((candidate) => candidate.claim_id));
    expect(selected).toContain("good-ai");
    expect(selected).toContain("good-finance");
    expect(selected).not.toContain("weak-ai");
    expect(selected).not.toContain("weak-finance");
  });

  test("prefers concrete current strategy claims over tables and org compensation artifacts", () => {
    const report = buildHxyKnowledgeGovernanceReport([
      claim({
        claim_id: "stage-table",
        claim_type: "brand_positioning",
        claim: "阶段目标拆解 阶段 时间 核心目标 关键指标 冷启动 开店前 2-3 月 社区介入，种植信任种子。",
        confidence: 0.95,
      }),
      claim({
        claim_id: "good-positioning",
        claim_type: "brand_positioning",
        claim: "荷小悦当前主定位是社区泡脚按摩小店，以真实有效、社区信任和私域复购为核心。",
        confidence: 0.78,
      }),
      claim({
        claim_id: "family-card",
        claim_type: "product_service",
        claim: "家庭健康卡绑定家人，LTV 预测后发送高价值套餐邀约。",
        confidence: 0.95,
      }),
      claim({
        claim_id: "good-price",
        claim_type: "product_service",
        claim: "招牌款60分钟现煮草本泡脚+手法按摩+护理包，价格128元。",
        confidence: 0.74,
      }),
      claim({
        claim_id: "cmo-pay",
        claim_type: "financial_assumption",
        claim: "荷小悦 CMO 薪酬方案，基本月薪 2 万/月，年度绩效 20-50 万。",
        confidence: 0.95,
      }),
      claim({
        claim_id: "fund-usage",
        claim_type: "financial_assumption",
        claim: "品牌影响力建设，AI数字化15%，产品研发10%，投资回报与风险控制，短期门店增长。",
        confidence: 0.98,
      }),
      claim({
        claim_id: "good-store-finance",
        claim_type: "financial_assumption",
        claim: "单店投资50万元，月营收18万元，月净利润6.4万元，回本周期6-8个月。",
        confidence: 0.7,
      }),
      claim({
        claim_id: "supplier-table",
        claim_type: "product_service",
        claim: "账、税务申报、全网流水、供应商 Portal、按时回款、对账、发货确认。",
        confidence: 0.99,
      }),
      claim({
        claim_id: "good-data-ai",
        claim_type: "product_service",
        claim: "AI 诊断结果自动生成调理方案，并沉淀健康档案、复购标签和服务推荐。",
        confidence: 0.74,
      }),
    ]);

    const selected = new Set(report.recommended_current_candidates.map((candidate) => candidate.claim_id));
    expect(selected).toContain("good-positioning");
    expect(selected).toContain("good-price");
    expect(selected).toContain("good-store-finance");
    expect(selected).toContain("good-data-ai");
    expect(selected).not.toContain("stage-table");
    expect(selected).not.toContain("family-card");
    expect(selected).not.toContain("cmo-pay");
    expect(selected).not.toContain("fund-usage");
    expect(selected).not.toContain("supplier-table");
  });
});
