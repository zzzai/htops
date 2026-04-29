import {
  extractHermesFrontdoorEvent,
  renderHermesFrontdoorSummary,
  summarizeHermesFrontdoorEvents,
} from "./hermes-frontdoor-summary.js";

import { describe, expect, it } from "vitest";

describe("hermes frontdoor summary", () => {
  it("extracts frontdoor events from gateway log lines", () => {
    const line =
      "2026-04-16 19:10:00,000 INFO sitecustomize: htops_hermes_frontdoor lane=general-lite reason=explanatory-question chat_id=ZhangZhen user_id=ZhangZhen";

    expect(extractHermesFrontdoorEvent(line)).toEqual({
      lane: "general-lite",
      reason: "explanatory-question",
      chatId: "ZhangZhen",
      userId: "ZhangZhen",
      timestamp: "2026-04-16 19:10:00,000",
      rawLine: line,
    });
  });

  it("summarizes lane and reason counts", () => {
    const summary = summarizeHermesFrontdoorEvents([
      {
        lane: "general-simple",
        reason: "greeting",
        chatId: "chat-1",
        userId: "user-1",
        timestamp: "2026-04-16 19:10:00,000",
        rawLine: "line-1",
      },
      {
        lane: "general-lite",
        reason: "explanatory-question",
        chatId: "chat-1",
        userId: "user-1",
        timestamp: "2026-04-16 19:10:01,000",
        rawLine: "line-2",
      },
      {
        lane: "general-lite",
        reason: "explanatory-question",
        chatId: "chat-2",
        userId: "user-2",
        timestamp: "2026-04-16 19:10:02,000",
        rawLine: "line-3",
      },
      {
        lane: "full-hermes",
        reason: "complex-request",
        chatId: "chat-3",
        userId: "user-3",
        timestamp: "2026-04-16 19:10:03,000",
        rawLine: "line-4",
      },
    ]);

    expect(summary).toMatchObject({
      total: 4,
      uniqueChats: 3,
      uniqueUsers: 3,
      lanes: [
        { key: "general-lite", count: 2 },
        { key: "full-hermes", count: 1 },
        { key: "general-simple", count: 1 },
      ],
      reasons: [
        { key: "explanatory-question", count: 2 },
        { key: "complex-request", count: 1 },
        { key: "greeting", count: 1 },
      ],
    });
  });

  it("renders a readable text summary", () => {
    const text = renderHermesFrontdoorSummary(
      summarizeHermesFrontdoorEvents([
        {
          lane: "business-bridge",
          reason: "business-router",
          chatId: "chat-1",
          userId: "user-1",
          timestamp: "2026-04-16 19:10:00,000",
          rawLine: "line-1",
        },
        {
          lane: "general-simple",
          reason: "greeting",
          chatId: "chat-2",
          userId: "user-2",
          timestamp: "2026-04-16 19:10:01,000",
          rawLine: "line-2",
        },
      ]),
    );

    expect(text).toContain("Hermes frontdoor summary");
    expect(text).toContain("Total events: 2");
    expect(text).toContain("business-bridge: 1");
    expect(text).toContain("general-simple: 1");
  });
});
