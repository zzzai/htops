import { describe, expect, it } from "vitest";
import {
  buildCorrectionInterruptKey,
  createCorrectionInterruptService,
} from "./correction-interrupt-service.js";

describe("correction interrupt", () => {
  it("reuses the previous business turn when the user says the reply was wrong", () => {
    const service = createCorrectionInterruptService({
      ttlMs: 180_000,
      now: () => 1_000,
    });
    const key = buildCorrectionInterruptKey({
      channel: "wecom",
      accountId: "acct-1",
      conversationId: "conv-1",
      senderId: "user-1",
      threadId: "thread-1",
    });
    service.rememberTurn({
      key,
      userText: "义乌店营收怎么样",
      assistantText: "当前已支持：\n- 昨天营收",
      occurredAtMs: 900,
    });

    expect(
      service.resolveCorrection({
        key,
        text: "不是这个意思，别套模板",
      }),
    ).toEqual({
      action: "repair",
      reason: "live-correction",
      previousUserText: "义乌店营收怎么样",
      prefixText: "我按刚才那条门店问题重答：",
    });
  });

  it("ignores stale turns outside the ttl window", () => {
    const service = createCorrectionInterruptService({
      ttlMs: 50,
      now: () => 1_000,
    });
    const key = buildCorrectionInterruptKey({
      channel: "wecom",
      accountId: undefined,
      conversationId: "conv-1",
      senderId: "user-1",
      threadId: undefined,
    });
    service.rememberTurn({
      key,
      userText: "义乌店营收怎么样",
      assistantText: "当前已支持：\n- 昨天营收",
      occurredAtMs: 900,
    });

    expect(
      service.resolveCorrection({
        key,
        text: "乱回了",
      }),
    ).toEqual({
      action: "continue",
    });
  });
});
