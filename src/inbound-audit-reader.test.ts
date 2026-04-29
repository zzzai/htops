import { describe, expect, it, vi } from "vitest";

import { listInboundAuditsReadOnly } from "./inbound-audit-reader.js";

describe("listInboundAuditsReadOnly", () => {
  it("builds a filtered read-only query and maps rows into inbound audit records", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: 12,
          request_id: "req-1",
          channel: "wecom",
          account_id: "acc-1",
          sender_id: "sender-1",
          sender_name: "张震",
          conversation_id: "conv-1",
          thread_id: "thread-1",
          is_group: true,
          was_mentioned: false,
          platform_message_id: "platform-1",
          content: "义乌店昨天营收多少",
          effective_content: "@bot 义乌店昨天营收多少",
          received_at: "2026-04-15T19:00:00+08:00",
          recorded_at: "2026-04-15T19:00:01+08:00",
        },
      ],
    });

    const result = await listInboundAuditsReadOnly(
      { query },
      {
        channel: "wecom",
        senderId: "sender-1",
        conversationId: "conv-1",
        contains: "义乌店",
        limit: 300,
      },
    );

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, Array<string | number>];
    expect(sql).toContain("FROM inbound_message_audit_logs");
    expect(sql).toContain("channel = $1");
    expect(sql).toContain("sender_id = $2");
    expect(sql).toContain("conversation_id = $3");
    expect(sql).toContain("COALESCE(sender_name, '') ILIKE $4");
    expect(params).toEqual(["wecom", "sender-1", "conv-1", "%义乌店%", 200]);
    expect(result).toEqual([
      {
        id: 12,
        requestId: "req-1",
        channel: "wecom",
        accountId: "acc-1",
        senderId: "sender-1",
        senderName: "张震",
        conversationId: "conv-1",
        threadId: "thread-1",
        isGroup: true,
        wasMentioned: false,
        platformMessageId: "platform-1",
        content: "义乌店昨天营收多少",
        effectiveContent: "@bot 义乌店昨天营收多少",
        receivedAt: "2026-04-15T19:00:00+08:00",
        recordedAt: "2026-04-15T19:00:01+08:00",
      },
    ]);
  });
});
