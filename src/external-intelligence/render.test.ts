import { describe, expect, it } from "vitest";
import { renderExternalBriefIssue, renderExternalBriefItem } from "./render.js";

describe("renderExternalBriefItem", () => {
  it("renders title, tag, time, source, summary paragraph, and why-it-matters line", () => {
    const text = renderExternalBriefItem({
      rank: 1,
      title: "瑞幸价格带调整进入执行期",
      theme: "chain-brand",
      publishedAt: "2026-04-03T09:10:00+08:00",
      sourceLabels: ["瑞幸官方", "界面新闻"],
      summary:
        "瑞幸确认部分饮品价格进入新价格带，多个来源指向这一轮调价已经从回应阶段转向执行阶段，且商圈内价格比较将进一步放大。",
      whyItMatters: "今天需要复核本地团购价格带、主推套餐和到店转化波动。",
    });

    expect(text).toContain("1. 瑞幸价格带调整进入执行期");
    expect(text).toContain("标签：连锁品牌");
    expect(text).toContain("时间：2026-04-03 09:10");
    expect(text).toContain("来源：瑞幸官方、界面新闻");
    expect(text).toContain("摘要：瑞幸确认部分饮品价格进入新价格带");
    expect(text).toContain("经营提示：今天需要复核本地团购价格带、主推套餐和到店转化波动。");
  });
});

describe("renderExternalBriefIssue", () => {
  it("renders a concise HQ issue with grouped items", () => {
    const text = renderExternalBriefIssue({
      issueDate: "2026-04-03",
      topic: "何棠 HQ 外部情报简报",
      overview:
        "今日外部环境的核心变化集中在价格竞争和平台流量规则，适合总部先判断是否需要同步到今日门店动作。",
      items: [
        {
          rank: 1,
          title: "瑞幸价格带调整进入执行期",
          theme: "chain-brand",
          publishedAt: "2026-04-03T09:10:00+08:00",
          sourceLabels: ["瑞幸官方", "界面新闻"],
          summary: "瑞幸调价已从回应转向执行，本地消费者对价格带的比较会进一步增强。",
          whyItMatters: "今天需要盯紧本地团购价格带和转化波动。",
        },
        {
          rank: 2,
          title: "平台补贴口径出现新变化",
          theme: "platform-rule",
          publishedAt: "2026-04-03T08:20:00+08:00",
          sourceLabels: ["平台公告"],
          summary: "平台开始调整部分补贴表达和履约说明，商家侧的投放和核销判断会受到影响。",
          whyItMatters: "今天要复核平台投放动作和履约承诺口径。",
        },
      ],
    });

    expect(text).toContain("何棠 HQ 外部情报简报");
    expect(text).toContain("日期：2026-04-03");
    expect(text).toContain("今日判断：今日外部环境的核心变化集中在价格竞争和平台流量规则");
    expect(text).toContain("## 连锁品牌");
    expect(text).toContain("## 平台规则");
    expect(text).toContain("1. 瑞幸价格带调整进入执行期");
    expect(text).toContain("2. 平台补贴口径出现新变化");
  });
});
