import { describe, expect, it, vi } from "vitest";
import { HetangConversationSemanticStateStore } from "./conversation-semantic-state-store.js";

describe("HetangConversationSemanticStateStore", () => {
  it("initializes semantic state storage with typed timestamps and without anchor-fact tables", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const store = new HetangConversationSemanticStateStore({ query } as never);

    await store.initialize();

    const initSql = String(query.mock.calls[0]?.[0] ?? "");
    expect(initSql).toContain("updated_at TIMESTAMPTZ NOT NULL");
    expect(initSql).toContain("expires_at TIMESTAMPTZ");
    expect(initSql).not.toContain("conversation_anchor_facts");
  });

  it("normalizes pg timestamp values back to ISO strings when reading semantic state", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            session_id: "wecom:conv-1",
            channel: "wecom",
            clarification_pending: true,
            clarification_reason: "missing-time",
            anchored_slots_json: {},
            missing_slots_json: [],
            belief_state_json: {},
            desire_state_json: {},
            intention_state_json: {},
            confidence: 1,
            updated_at: new Date("2026-04-17T09:00:00.000Z"),
            expires_at: new Date("2026-04-17T10:00:00.000Z"),
          },
        ],
      });
    const store = new HetangConversationSemanticStateStore({ query } as never);

    await expect(store.getConversationSemanticState("wecom:conv-1")).resolves.toMatchObject({
      updatedAt: "2026-04-17T09:00:00.000Z",
      expiresAt: "2026-04-17T10:00:00.000Z",
    });
  });
});
