import { describe, expect, it } from "vitest";
import {
  findOperatingMetricContractsByMetricKey,
  hasOperatingMetricContract,
  hasOperatingDependencyContract,
  findOperatingDependencyContractById,
  listSemanticQuestionFamilies,
  listOperatingAnswerTemplates,
  findOperatingAnswerTemplateByFamilyId,
  listProactiveDiagnosisContracts,
  listOperatingAnalysisRecipes,
  searchOperatingKnowledgeCatalog,
} from "./semantic-operating-contract.js";

describe("semantic operating metric contracts", () => {
  it("resolves registered monthly operating metric contracts by metric key", () => {
    expect(findOperatingMetricContractsByMetricKey("cashPerformance")).toEqual([
      expect.objectContaining({
        id: "metric:cash_performance",
        metric_key: "cashPerformance",
        local_truth_surface: expect.stringContaining("MonthlyOperatingMetrics.cashPerformance"),
      }),
    ]);
  });

  it("reports whether a metric key has a machine-readable operating contract", () => {
    expect(hasOperatingMetricContract("attendanceRate")).toBe(true);
    expect(hasOperatingMetricContract("grossMarginRate")).toBe(false);
  });

  it("resolves the formal cost-model dependency contract by id", () => {
    expect(hasOperatingDependencyContract("store_cost_model")).toBe(true);
    expect(findOperatingDependencyContractById("store_cost_model")).toEqual(
      expect.objectContaining({
        id: "store_cost_model",
        support_status: "data_gap_model",
      }),
    );
  });

  it("returns bounded knowledge docs for profit/cost-model explanation asks", () => {
    const result = searchOperatingKnowledgeCatalog({
      query: "利润口径",
      limit: 3,
    });

    expect(result.documents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: expect.stringContaining("利润"),
        }),
      ]),
    );
  });

  it("returns boundary docs for external research lane asks", () => {
    const result = searchOperatingKnowledgeCatalog({
      query: "竞品分析",
      limit: 3,
    });

    expect(result.documents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: expect.stringContaining("外部研究"),
        }),
      ]),
    );
  });

  it("keeps realtime queue and pending-settlement asks registered as explicit realtime data gaps", () => {
    const families = listSemanticQuestionFamilies();
    const realtimeFamily = families.find((entry) => entry.id === "manager-realtime-floor");

    expect(realtimeFamily?.mappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "realtime-queue-and-pending-settlement",
          support_status: "data_gap_realtime",
          recipe_refs: expect.arrayContaining([
            "analysis:realtime_floor_state",
            "metric:realtime_queue_status",
            "metric:pending_settlement_status",
          ]),
        }),
      ]),
    );
  });

  it("returns boundary docs for realtime queue and pending-settlement asks", () => {
    const queueDocs = searchOperatingKnowledgeCatalog({
      query: "等位",
      limit: 3,
    });
    const settlementDocs = searchOperatingKnowledgeCatalog({
      query: "待结账",
      limit: 3,
    });

    expect(queueDocs.documents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: expect.stringContaining("实时"),
        }),
      ]),
    );
    expect(settlementDocs.documents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: expect.stringContaining("实时"),
        }),
      ]),
    );
  });

  it("registers planned cost-model and profitability analysis recipes without binding them to live capabilities", () => {
    const recipes = listOperatingAnalysisRecipes();

    expect(recipes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "analysis:store_cost_model_review",
          current_capability_id: null,
        }),
        expect.objectContaining({
          id: "analysis:store_profitability_review",
          current_capability_id: null,
        }),
      ]),
    );
  });

  it("binds at least 100 high-frequency natural questions to answer templates", () => {
    const families = listSemanticQuestionFamilies();
    const templates = listOperatingAnswerTemplates();
    const templatedFamilyIds = new Set(templates.map((template) => template.family_id));
    const coveredQuestionCount = families
      .filter((family) => templatedFamilyIds.has(family.id))
      .reduce((sum, family) => sum + family.question_count, 0);

    expect(coveredQuestionCount).toBeGreaterThanOrEqual(100);
    expect(findOperatingAnswerTemplateByFamilyId("boss-daily-revenue")).toMatchObject({
      family_id: "boss-daily-revenue",
      answer_mode: "metric_snapshot",
      template: expect.stringContaining("实收"),
      unavailable_template: expect.stringContaining("不能严肃回答"),
    });
  });

  it("registers the approved business pain signal categories as proactive diagnosis contracts", () => {
    const diagnoses = listProactiveDiagnosisContracts();
    const ids = diagnoses.map((entry) => entry.id);

    expect(ids).toEqual(
      expect.arrayContaining([
        "pain:revenue_drop",
        "pain:traffic_drop",
        "pain:recharge_weakening",
        "pain:stored_value_pressure",
        "pain:new_customer_waste",
        "pain:tech_dependency",
        "pain:tech_productivity_anomaly",
        "pain:point_clock_drop",
        "pain:attendance_anomaly",
        "pain:anti_settle_anomaly",
        "pain:discount_anomaly",
        "pain:data_risk",
      ]),
    );
    expect(diagnoses.find((entry) => entry.id === "pain:revenue_drop")).toMatchObject({
      label: "营收下滑",
      execution: {
        mode: "scheduled_diagnosis",
        scheduler_hook: "build-report",
        delivery_surface: expect.stringContaining("daily report"),
      },
      objective: expect.stringContaining("客单价"),
    });
  });
});
