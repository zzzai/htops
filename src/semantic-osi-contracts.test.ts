import { describe, expect, it } from "vitest";
import { listCapabilityGraphNodes } from "./capability-graph.js";
import {
  getSemanticOsiContract,
  listSemanticOsiContracts,
} from "./semantic-osi-contracts.js";

describe("semantic OSI contracts", () => {
  it("defines customer, technician, and store as the core OSI domains", () => {
    expect(listSemanticOsiContracts().map((contract) => contract.domain).sort()).toEqual([
      "customer",
      "store",
      "technician",
    ]);
  });

  it("defines the customer OSI with fields, segments, relationships, capabilities, and recipes", () => {
    const customer = getSemanticOsiContract("customer");

    expect(customer?.base_fields.map((field) => field.key)).toEqual(
      expect.arrayContaining([
        "customer_identity_key",
        "member_id",
        "org_id",
        "last_visit_date",
        "stored_balance",
        "total_pay_amount",
        "visit_count_90d",
        "primary_tech_code",
      ]),
    );
    expect(customer?.segments.map((segment) => segment.key)).toEqual(
      expect.arrayContaining([
        "high_balance_sleeping",
        "groupbuy_revisit_candidate",
        "recharge_not_visited_member",
        "birthday_window_member",
      ]),
    );
    expect(customer?.relationships.map((relationship) => relationship.key)).toEqual(
      expect.arrayContaining([
        "customer_to_store",
        "customer_to_technician",
        "customer_tag_to_action_recipe",
      ]),
    );
    expect(customer?.capabilities.map((capability) => capability.capability_id)).toEqual(
      expect.arrayContaining([
        "customer_profile_lookup_v1",
        "customer_segment_list_v1",
        "customer_ranked_list_lookup_v1",
        "customer_relation_lookup_v1",
      ]),
    );
  });

  it("keeps every OSI capability bound to the existing capability graph", () => {
    const capabilityIds = new Set(
      listCapabilityGraphNodes().map((node) => node.capability_id),
    );

    for (const contract of listSemanticOsiContracts()) {
      for (const capability of contract.capabilities) {
        expect(capabilityIds.has(capability.capability_id), capability.capability_id).toBe(true);
      }
    }
  });
});
