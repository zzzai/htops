import { describe, expect, it } from "vitest";
import { listCapabilityGraphNodes } from "./capability-graph.js";
import {
  listOperatingAnalysisRecipes,
  listOperatingKnowledgeDocuments,
  listOperatingMetricContracts,
  listOperatingSegmentContracts,
  listProactiveDiagnosisContracts,
  listSemanticQuestionFamilies,
  searchOperatingKnowledgeCatalog,
} from "./semantic-operating-contract.js";

describe("semantic operating contract", () => {
  it("organizes the 150-question corpus into 26 question families", () => {
    const families = listSemanticQuestionFamilies();
    const totalQuestions = families.reduce((sum, family) => sum + family.question_count, 0);

    expect(families).toHaveLength(26);
    expect(totalQuestions).toBe(150);
    expect(new Set(families.map((family) => family.role))).toEqual(new Set(["boss", "manager", "crm"]));
  });

  it("keeps implemented family mappings inside the current capability graph", () => {
    const capabilities = new Set(listCapabilityGraphNodes().map((node) => node.capability_id));
    const families = listSemanticQuestionFamilies();

    for (const family of families) {
      for (const mapping of family.mappings) {
        if (mapping.support_status !== "implemented") {
          continue;
        }
        expect(mapping.capability_id, `${family.id}:${mapping.id}`).toBeTruthy();
        expect(capabilities.has(mapping.capability_id ?? ""), `${family.id}:${mapping.id}`).toBe(true);
      }
    }
  });

  it("exposes metric, segment, and analysis contracts that cover all referenced recipes", () => {
    const metricIds = new Set(listOperatingMetricContracts().map((entry) => entry.id));
    const segmentIds = new Set(listOperatingSegmentContracts().map((entry) => entry.id));
    const analysisIds = new Set(listOperatingAnalysisRecipes().map((entry) => entry.id));

    const allRecipeIds = new Set([
      ...metricIds,
      ...segmentIds,
      ...analysisIds,
    ]);

    for (const family of listSemanticQuestionFamilies()) {
      for (const mapping of family.mappings) {
        for (const recipeId of mapping.recipe_refs) {
          expect(allRecipeIds.has(recipeId), `${family.id}:${mapping.id}:${recipeId}`).toBe(true);
        }
      }
    }
  });

  it("defines proactive diagnoses through bounded capability or schedule hooks", () => {
    const diagnoses = listProactiveDiagnosisContracts();

    expect(diagnoses.length).toBeGreaterThanOrEqual(4);
    expect(diagnoses.some((entry) => entry.execution.mode === "scheduled_diagnosis")).toBe(true);
    expect(diagnoses.some((entry) => entry.execution.mode === "interactive_capability")).toBe(true);
  });

  it("keeps knowledge retrieval restricted to rules, SOPs, and metric definitions", () => {
    const docs = listOperatingKnowledgeDocuments();
    const result = searchOperatingKnowledgeCatalog({
      query: "营收口径",
      limit: 3,
    });

    expect(docs.length).toBeGreaterThanOrEqual(3);
    expect(result.boundary.allowed_domains).toEqual(
      expect.arrayContaining(["metric_definition", "report_scope_definition", "store_sop"]),
    );
    expect(result.boundary.blocked_fact_classes).toEqual(
      expect.arrayContaining(["transaction_facts", "member_raw_detail", "tech_payroll_detail"]),
    );
    expect(result.documents[0]).toMatchObject({
      domain: "metric_definition",
      title: expect.stringContaining("指标"),
    });
  });
});
