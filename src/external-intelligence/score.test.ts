import { describe, expect, it } from "vitest";
import { scoreExternalEvent } from "./score.js";

describe("scoreExternalEvent", () => {
  it("scores a fresh s-tier event above a weak b-tier lead", () => {
    const strong = scoreExternalEvent({
      theme: "pricing-competition",
      sourceTiers: ["s"],
      freshness: {
        qualifies: true,
        reason: "within-window",
      },
      blockedReason: undefined,
      summary: "官方确认部分饮品进入新价格带。",
    });

    const weak = scoreExternalEvent({
      theme: "general-hot-topic",
      sourceTiers: ["b"],
      freshness: {
        qualifies: true,
        reason: "within-window",
      },
      blockedReason: "needs-source-confirmation",
      summary: "热榜线索，尚未有强源确认。",
    });

    expect(strong.totalScore).toBeGreaterThan(weak.totalScore);
    expect(strong.passesThreshold).toBe(true);
    expect(weak.passesThreshold).toBe(false);
  });

  it("applies a soft-article penalty that pushes the score below threshold", () => {
    const result = scoreExternalEvent({
      theme: "strategy-organization",
      sourceTiers: ["a"],
      freshness: {
        qualifies: true,
        reason: "within-window",
      },
      blockedReason: "blocked-soft-article",
      summary: "咨询机构方法论宣传稿。",
    });

    expect(result.totalScore).toBeLessThan(result.threshold);
    expect(result.passesThreshold).toBe(false);
  });
});
