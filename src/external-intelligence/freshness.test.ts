import { describe, expect, it } from "vitest";
import { evaluateExternalFreshness } from "./freshness.js";

describe("evaluateExternalFreshness", () => {
  const now = "2026-04-03T12:00:00+08:00";

  it("qualifies an event inside 72 hours", () => {
    expect(
      evaluateExternalFreshness(
        {
          eventAt: "2026-04-02T08:00:00+08:00",
          publishedAt: "2026-04-02T09:00:00+08:00",
          hasMaterialUpdate: false,
        },
        { now, freshnessHours: 72 },
      ),
    ).toMatchObject({
      qualifies: true,
      reason: "within-window",
    });
  });

  it("rejects an old event with no new progress", () => {
    expect(
      evaluateExternalFreshness(
        {
          eventAt: "2026-03-20T08:00:00+08:00",
          publishedAt: "2026-04-03T09:00:00+08:00",
          hasMaterialUpdate: false,
        },
        { now, freshnessHours: 72 },
      ),
    ).toMatchObject({
      qualifies: false,
      reason: "stale-without-update",
    });
  });

  it("qualifies an old event when material update appears today", () => {
    expect(
      evaluateExternalFreshness(
        {
          eventAt: "2026-03-20T08:00:00+08:00",
          publishedAt: "2026-04-03T10:30:00+08:00",
          hasMaterialUpdate: true,
        },
        { now, freshnessHours: 72 },
      ),
    ).toMatchObject({
      qualifies: true,
      reason: "stale-but-material-update",
    });
  });

  it("treats an invalid now value as missing reliable time instead of returning NaN-driven output", () => {
    expect(
      evaluateExternalFreshness(
        {
          eventAt: "2026-04-02T08:00:00+08:00",
          publishedAt: "2026-04-02T09:00:00+08:00",
          hasMaterialUpdate: false,
        },
        { now: "not-a-date", freshnessHours: 72 },
      ),
    ).toMatchObject({
      qualifies: false,
      reason: "missing-reliable-time",
    });
  });
});
