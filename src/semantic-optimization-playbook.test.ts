import { describe, expect, it } from "vitest";
import {
  getDefaultSemanticOptimizationPlaybookEntry,
  resolveSemanticOptimizationPlaybookEntry,
} from "./semantic-optimization-playbook.js";

describe("semantic optimization playbook", () => {
  it("resolves configured owner guidance for known failure classes", () => {
    expect(resolveSemanticOptimizationPlaybookEntry("generic_unmatched")).toMatchObject({
      ownerModule: "src/semantic-intent.ts",
      priority: "high",
      samples: [
        expect.objectContaining({
          sampleTag: "boss_open_guidance",
          prompt: "哪个门店须重点关注",
        }),
      ],
    });
  });

  it("falls back to the default playbook entry for unknown failure classes", () => {
    expect(getDefaultSemanticOptimizationPlaybookEntry()).toMatchObject({
      ownerModule: "src/semantic-intent.ts",
      priority: "medium",
    });
    expect(resolveSemanticOptimizationPlaybookEntry("totally_unknown_failure")).toEqual(
      getDefaultSemanticOptimizationPlaybookEntry(),
    );
  });
});
