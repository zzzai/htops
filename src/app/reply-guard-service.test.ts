import { describe, expect, it } from "vitest";
import { resolveHetangOpsConfig } from "../config.js";
import { resolveReplyGuardDecision, shouldRunReplyGuard } from "./reply-guard-service.js";

function buildConfig() {
  return resolveHetangOpsConfig({
    api: {
      appKey: "demo-app-key",
      appSecret: "demo-app-secret",
    },
    database: {
      url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
    },
    stores: [
      { orgId: "1001", storeName: "义乌店", rawAliases: ["义乌"] },
      { orgId: "1002", storeName: "迎宾店", rawAliases: ["迎宾"] },
      { orgId: "1003", storeName: "荷塘悦色园中园店", rawAliases: ["园中园店"] },
    ],
  });
}

describe("reply guard", () => {
  const config = buildConfig();

  it("skips non-business chatter and explicit capability asks", () => {
    expect(shouldRunReplyGuard({ text: "帮我总结一下今天会上的发言" })).toBe(false);
    expect(shouldRunReplyGuard({ text: "你现在支持哪些能力" })).toBe(false);
    expect(shouldRunReplyGuard({ text: "义乌店营收怎么样" })).toBe(true);
  });

  it("asks for a repair when the reply leaks another store", () => {
    expect(
      resolveReplyGuardDecision({
        config,
        userText: "义乌店昨天营收多少",
        replyText: "迎宾店 2026-04-12 指标查询\n- 服务营收: 2680.00 元",
      }),
    ).toEqual({
      action: "repair",
      reason: "store-mismatch",
    });
  });

  it("replaces negative-constraint violations with a tight clarification", () => {
    expect(
      resolveReplyGuardDecision({
        config,
        userText: "不要给义乌店经营复盘",
        replyText: "义乌店 经营复盘\n结论摘要\n今天重点看复购。",
      }),
    ).toEqual({
      action: "clarify",
      reason: "negative-constraint-violation",
      text: "好，这次不按经营复盘回。你直接说：义乌店昨天经营数据报告，或 义乌店总钟数怎么构成。",
    });
  });

  it("blocks business capability templates and converts them into a real clarification", () => {
    const decision = resolveReplyGuardDecision({
      config,
      userText: "义乌店营收怎么样",
      replyText: "当前已支持：\n- 昨天营收\n- 近7天经营复盘",
    });

    expect(decision).toEqual({
      action: "clarify",
      reason: "business-template-mismatch",
      text: "你要看义乌店昨天、近7天还是近30天？",
    });
  });

  it("blocks generic unmatched text for follow-up asks", () => {
    const decision = resolveReplyGuardDecision({
      config,
      userText: "义乌店最值得召回的顾客是哪个",
      replyText: "未识别为可执行的门店数据问题，请补充门店、时间或指标。",
    });

    expect(decision).toEqual({
      action: "clarify",
      reason: "generic-unmatched-business-ask",
      text: "我先不回空话。直接说：义乌店高价值待唤回名单，或 义乌店近30天最值得召回的顾客名单。",
    });
  });

  it("treats a shortened store alias and the canonical store name as the same store", () => {
    expect(
      resolveReplyGuardDecision({
        config,
        userText: "园中园昨天营收多少",
        replyText: "荷塘悦色园中园店 2026-04-12 指标查询\n- 服务营收: 2680.00 元",
      }),
    ).toEqual({
      action: "send",
    });
  });
});
