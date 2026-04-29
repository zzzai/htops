import { describe, expect, it } from "vitest";
import { resolveHetangOpsConfig } from "../config.js";
import { resolveHetangQueryIntent } from "../query-intent.js";
import type { HetangEmployeeBinding } from "../types.js";
import { resolveIntentClarifierDecision } from "./intent-clarifier-service.js";

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
      { orgId: "1003", storeName: "华美店", rawAliases: ["华美"] },
    ],
  });
}

const HQ_BINDING: HetangEmployeeBinding = {
  channel: "wecom",
  senderId: "hq-1",
  employeeName: "总部甲",
  role: "hq",
  isActive: true,
};

const YIWU_MANAGER_BINDING: HetangEmployeeBinding = {
  channel: "wecom",
  senderId: "manager-yiwu",
  employeeName: "义乌店长",
  role: "manager",
  isActive: true,
  scopeOrgIds: ["1001"],
};

describe("resolveIntentClarifierDecision", () => {
  const config = buildConfig();
  const now = new Date("2026-04-13T09:00:00+08:00");

  it("clarifies when a multi-store user asks for a metric without naming the store", () => {
    const text = "昨天营收多少";

    expect(
      resolveIntentClarifierDecision({
        config,
        text,
        binding: HQ_BINDING,
        ruleIntent: resolveHetangQueryIntent({ config, text, now }),
      }),
    ).toEqual({
      kind: "clarify",
      reason: "missing-store",
      text: "你是看哪家店？比如：义乌店昨天营收多少。",
    });
  });

  it("clarifies when a single-store ask is missing a time scope", () => {
    const text = "义乌店营收怎么样";

    expect(
      resolveIntentClarifierDecision({
        config,
        text,
        binding: HQ_BINDING,
        ruleIntent: resolveHetangQueryIntent({ config, text, now }),
      }),
    ).toEqual({
      kind: "clarify",
      reason: "missing-time",
      text: "你要看义乌店昨天、近7天还是近30天？",
    });
  });

  it("clarifies mixed hq and single-store scope before routing", () => {
    const text = "总部先看五店，再看义乌店哪里有问题";

    expect(
      resolveIntentClarifierDecision({
        config,
        text,
        binding: HQ_BINDING,
        ruleIntent: resolveHetangQueryIntent({ config, text, now }),
      }),
    ).toEqual({
      kind: "clarify",
      reason: "mixed-scope",
      text: "你是先看五店全景，还是先看义乌店？拆成两句我会答得最准。",
    });
  });

  it("clarifies report asks that name the store but omit the time window", () => {
    const text = "义乌店日报";

    expect(
      resolveIntentClarifierDecision({
        config,
        text,
        binding: HQ_BINDING,
        ruleIntent: resolveHetangQueryIntent({ config, text, now }),
      }),
    ).toEqual({
      kind: "clarify",
      reason: "missing-time",
      text: "你要看义乌店昨天、近7天还是近30天？",
    });
  });

  it("continues when a single-store manager omits the store but the scope is unambiguous", () => {
    const text = "昨天营收多少";

    expect(
      resolveIntentClarifierDecision({
        config,
        text,
        binding: YIWU_MANAGER_BINDING,
        ruleIntent: resolveHetangQueryIntent({ config, text, now }),
      }),
    ).toEqual({
      kind: "continue",
    });
  });
});
