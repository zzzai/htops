import { describe, expect, it } from "vitest";

import {
  CUSTOMER_OBSERVATION_SOURCE_ROLES,
  CUSTOMER_OBSERVATION_SOURCE_TYPES,
  CUSTOMER_OBSERVATION_TRUTH_BOUNDARIES,
  CUSTOMER_OPERATING_SCORING_SCOPES,
} from "./types.js";

describe("customer operating profile types", () => {
  it("exposes stable runtime boundaries for observation and scoring layers", () => {
    expect(CUSTOMER_OBSERVATION_TRUTH_BOUNDARIES).toEqual([
      "hard_fact",
      "observed_fact",
      "inferred_label",
      "predicted_signal",
    ]);
    expect(CUSTOMER_OBSERVATION_SOURCE_TYPES).toEqual([
      "self_reported",
      "staff_observed",
      "system_fact",
      "system_inferred",
    ]);
    expect(CUSTOMER_OBSERVATION_SOURCE_ROLES).toEqual([
      "technician",
      "front_desk",
      "customer_service",
      "store_manager",
      "system",
    ]);
    expect(CUSTOMER_OPERATING_SCORING_SCOPES).toEqual([
      "none",
      "action_only",
      "profile_allowed",
    ]);
  });
});
