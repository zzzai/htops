import { describe, expect, it, vi } from "vitest";
import { HetangSemanticExecutionAuditStore } from "./semantic-execution-audit-store.js";

describe("HetangSemanticExecutionAuditStore", () => {
  it("initializes semantic audit storage with a typed occurred_at column", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const store = new HetangSemanticExecutionAuditStore({ query } as never);

    await store.initialize();

    const initSql = String(query.mock.calls[0]?.[0] ?? "");
    expect(initSql).toContain("occurred_at TIMESTAMPTZ NOT NULL");
  });

  it("persists deploy marker and serving version when writing semantic audits", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const store = new HetangSemanticExecutionAuditStore({ query } as never);

    await store.insertSemanticExecutionAudit({
      entry: "query",
      rawText: "义乌店近7天重点看什么",
      clarificationNeeded: false,
      fallbackUsed: false,
      executed: true,
      success: true,
      occurredAt: "2026-04-18T04:10:00.000Z",
      deployMarker: "serving:serving-20260418040000",
      servingVersion: "serving-20260418040000",
    });

    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining("deploy_marker"),
      expect.arrayContaining([
        "serving:serving-20260418040000",
        "serving-20260418040000",
      ]),
    );
  });

  it("filters semantic quality summary by deploy marker", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            total_count: 1,
            success_count: 1,
            clarify_count: 0,
            fallback_used_count: 0,
            latest_occurred_at: "2026-04-18T04:10:00.000Z",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const store = new HetangSemanticExecutionAuditStore({ query } as never);

    await store.getSemanticQualitySummary({
      windowHours: 24,
      now: new Date("2026-04-18T12:00:00.000Z"),
      limit: 5,
      deployMarker: "serving:serving-20260418040000",
    });

    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("occurred_at >= $1::timestamptz"),
      ["2026-04-17T12:00:00.000Z", "serving:serving-20260418040000"],
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("deploy_marker = $2"),
      ["2026-04-17T12:00:00.000Z", "serving:serving-20260418040000"],
    );
  });

  it("normalizes aggregate timestamp results back to ISO strings", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            total_count: 1,
            success_count: 1,
            clarify_count: 0,
            fallback_used_count: 0,
            latest_occurred_at: new Date("2026-04-18T04:10:00.000Z"),
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const store = new HetangSemanticExecutionAuditStore({ query } as never);

    await expect(
      store.getSemanticQualitySummary({
        windowHours: 24,
        now: new Date("2026-04-18T12:00:00.000Z"),
        limit: 5,
      }),
    ).resolves.toMatchObject({
      latestOccurredAt: "2026-04-18T04:10:00.000Z",
    });
  });

  it("aggregates carry success and topic switch indicators in semantic quality summary", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            total_count: 6,
            success_count: 4,
            clarify_count: 1,
            fallback_used_count: 0,
            carry_success_count: 3,
            carry_opportunity_count: 4,
            topic_switch_count: 1,
            latest_occurred_at: "2026-04-18T04:10:00.000Z",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const store = new HetangSemanticExecutionAuditStore({ query } as never);

    await expect(
      store.getSemanticQualitySummary({
        windowHours: 24,
        now: new Date("2026-04-18T12:00:00.000Z"),
        limit: 5,
      }),
    ).resolves.toMatchObject({
      carrySuccessCount: 3,
      carrySuccessRate: 0.75,
      topicSwitchCount: 1,
    });
  });
});
