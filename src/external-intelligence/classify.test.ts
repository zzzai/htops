import { describe, expect, it } from "vitest";
import { classifyExternalTheme } from "./classify.js";

describe("classifyExternalTheme", () => {
  it("classifies 全网热点", () => {
    const result = classifyExternalTheme({
      sourceId: "gov-briefing",
      title: "国务院发布扩大内需若干措施",
      summary: "涉及消费提振与服务业支持政策",
      entity: "国务院",
      action: "发布政策",
    });

    expect(result).toMatchObject({
      themeKey: "general-hot-topic",
      themeLabel: "全网热点",
    });
  });

  it("classifies 连锁品牌", () => {
    const result = classifyExternalTheme({
      sourceId: "retail-media",
      title: "海底捞校园食堂新店落地",
      summary: "连锁品牌在新场景继续扩店",
      entity: "海底捞",
      action: "开店",
    });

    expect(result).toMatchObject({
      themeKey: "chain-brand",
      themeLabel: "连锁品牌",
    });
  });

  it("classifies 战略组织", () => {
    const result = classifyExternalTheme({
      sourceId: "business-media",
      title: "美的分享十年组织变革与数字化战略",
      summary: "从战略解码到组织执行系统升级",
      entity: "美的",
      action: "组织变革",
    });

    expect(result).toMatchObject({
      themeKey: "strategy-organization",
      themeLabel: "战略组织",
    });
  });

  it("classifies 平台规则", () => {
    const result = classifyExternalTheme({
      sourceId: "meituan-platform-announcement",
      title: "本地生活平台更新商家经营规范",
      summary: "调整核销与履约规则，影响商家日常运营",
      entity: "平台",
      action: "发布规则",
    });

    expect(result).toMatchObject({
      themeKey: "platform-rule",
      themeLabel: "平台规则",
    });
  });

  it("classifies 价格竞争", () => {
    const result = classifyExternalTheme({
      sourceId: "finance-media",
      title: "瑞幸多款饮品下调价格并回应价格战",
      summary: "多款产品进入更低价格带",
      entity: "瑞幸",
      action: "降价",
    });

    expect(result).toMatchObject({
      themeKey: "pricing-competition",
      themeLabel: "价格竞争",
    });
  });
});
