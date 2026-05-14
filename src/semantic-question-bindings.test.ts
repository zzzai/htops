import { describe, expect, it } from "vitest";
import { listCapabilityGraphNodes } from "./capability-graph.js";
import {
  listOperatingAnalysisRecipes,
  listOperatingMetricContracts,
  listOperatingSegmentContracts,
} from "./semantic-operating-contract.js";
import { listSemanticOsiContracts } from "./semantic-osi-contracts.js";
import { listSemanticQuestionBindings } from "./semantic-question-bindings.js";

describe("semantic question bindings", () => {
  it("binds exactly 100 high-frequency question families", () => {
    const bindings = listSemanticQuestionBindings();

    expect(bindings).toHaveLength(100);
    expect(new Set(bindings.map((binding) => binding.id)).size).toBe(100);
  });

  it("covers the three core OSI domains and the non-data frontdoor lanes", () => {
    const bindings = listSemanticQuestionBindings();
    const domains = new Set(bindings.map((binding) => binding.domain));
    const lanes = new Set(bindings.map((binding) => binding.frontdoor_lane));

    expect(domains.has("customer")).toBe(true);
    expect(domains.has("technician")).toBe(true);
    expect(domains.has("store")).toBe(true);
    expect(lanes.has("semantic_asset_design")).toBe(true);
    expect(lanes.has("book_knowledge_qa")).toBe(true);
    expect(lanes.has("brand_marketing_plan")).toBe(true);
  });

  it("binds data questions to real capabilities and known contracts", () => {
    const capabilityIds = new Set(
      listCapabilityGraphNodes().map((node) => node.capability_id),
    );
    const metricRefs = new Set(
      listOperatingMetricContracts().map((contract) => contract.id),
    );
    const segmentRefs = new Set(
      listOperatingSegmentContracts().map((contract) => contract.id),
    );
    const recipeRefs = new Set(
      listOperatingAnalysisRecipes().map((recipe) => recipe.id),
    );
    const osiDomains = new Set(
      listSemanticOsiContracts().map((contract) => contract.domain),
    );

    for (const binding of listSemanticQuestionBindings()) {
      if (binding.frontdoor_lane === "store_data_query") {
        expect(binding.capability_id, binding.id).toBeTruthy();
        expect(capabilityIds.has(binding.capability_id ?? ""), binding.id).toBe(true);
      }
      if (binding.osi_domain) {
        expect(osiDomains.has(binding.osi_domain), binding.id).toBe(true);
      }
      for (const metricRef of binding.metric_refs) {
        expect(metricRefs.has(metricRef), `${binding.id}:${metricRef}`).toBe(true);
      }
      for (const segmentRef of binding.segment_refs) {
        expect(segmentRefs.has(segmentRef), `${binding.id}:${segmentRef}`).toBe(true);
      }
      for (const recipeRef of binding.recipe_refs) {
        expect(recipeRefs.has(recipeRef), `${binding.id}:${recipeRef}`).toBe(true);
      }
    }
  });

  it("keeps missing-store clarification scoped to store data questions", () => {
    const bindings = listSemanticQuestionBindings();
    const clarifyStoreBindings = bindings.filter((binding) => binding.requires_store);

    expect(clarifyStoreBindings.length).toBeGreaterThan(50);
    expect(
      clarifyStoreBindings.every((binding) => binding.frontdoor_lane === "store_data_query"),
    ).toBe(true);
  });
});
