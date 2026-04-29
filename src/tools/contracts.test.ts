import { describe, expect, it } from "vitest";
import { buildHetangToolsCapabilities } from "./contracts.js";

describe("hetang tools contract", () => {
  it("declares the tool surface as a read-only function-calling entry adapter", () => {
    const capabilities = buildHetangToolsCapabilities();

    expect(capabilities.execution_boundary).toEqual({
      entry_role: "function_call_entry_adapter",
      access_mode: "read_only",
      business_logic_owner: "owner_modules",
    });
  });

  it("binds follow-up and profile tools to the same capability families used by the query plane", () => {
    const capabilities = buildHetangToolsCapabilities();
    const recallTool = capabilities.tools.find(
      (entry) => entry.name === "get_member_recall_candidates",
    );
    const profileTool = capabilities.tools.find(
      (entry) => entry.name === "get_customer_profile",
    );

    expect(recallTool?.semantic_capability_ids).toEqual([
      "customer_ranked_list_lookup_v1",
      "customer_segment_list_v1",
    ]);
    expect(profileTool?.semantic_capability_ids).toEqual([
      "customer_profile_lookup_v1",
      "customer_profile_runtime_lookup_v1",
    ]);
  });

  it("declares a bounded operating knowledge search tool that stays on the meta lane", () => {
    const capabilities = buildHetangToolsCapabilities();
    const knowledgeTool = capabilities.tools.find(
      (entry) => entry.name === "search_operating_knowledge",
    );

    expect(knowledgeTool).toMatchObject({
      name: "search_operating_knowledge",
      lane: "meta",
      owner_surface: "knowledge_registry",
    });
  });
});
