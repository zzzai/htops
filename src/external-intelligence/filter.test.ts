import { describe, expect, it } from "vitest";
import { filterExternalCandidate } from "./filter.js";

const NOW = new Date("2026-04-03T10:00:00+08:00");

describe("filterExternalCandidate", () => {
  it("rejects course-promo titles", () => {
    const result = filterExternalCandidate(
      {
        sourceTier: "a",
        sourceId: "sogou-news",
        title: "战略赋能4+N组织赋能系列大课即将开班",
        summary: "组织赋能课程介绍与招生信息",
        publishedAt: "2026-04-03T08:00:00+08:00",
      },
      {
        now: NOW,
        freshnessHours: 72,
      },
    );

    expect(result.decision).toEqual({
      accepted: false,
      reason: "blocked-course-promo",
    });
  });

  it("rejects consulting soft articles", () => {
    const result = filterExternalCandidate(
      {
        sourceTier: "a",
        sourceId: "soft-article-feed",
        title: "某咨询机构发布数字化转型方法论",
        summary: "通过驻场辅导帮助企业实现管理升级",
        publishedAt: "2026-04-03T08:30:00+08:00",
      },
      {
        now: NOW,
        freshnessHours: 72,
      },
    );

    expect(result.decision).toEqual({
      accepted: false,
      reason: "blocked-soft-article",
    });
  });

  it("rejects old-news resurfacing without new development", () => {
    const result = filterExternalCandidate(
      {
        sourceTier: "a",
        sourceId: "aggregator",
        title: "旧闻回顾：某连锁去年下调价格",
        summary: "无新增事件，只是复盘旧内容",
        publishedAt: "2026-04-03T09:00:00+08:00",
        eventAt: "2025-12-20T10:00:00+08:00",
        hasMaterialUpdate: false,
      },
      {
        now: NOW,
        freshnessHours: 72,
      },
    );

    expect(result.decision).toEqual({
      accepted: false,
      reason: "blocked-old-news-resurfacing",
    });
  });

  it("rejects documents without reliable time", () => {
    const result = filterExternalCandidate(
      {
        sourceTier: "s",
        sourceId: "official",
        title: "某平台发布业务动态",
        summary: "只有片段，没有可靠时间",
      },
      {
        now: NOW,
        freshnessHours: 72,
      },
    );

    expect(result.decision).toEqual({
      accepted: false,
      reason: "blocked-missing-reliable-time",
    });
  });

  it("keeps b-tier items as lead-only until stronger confirmation arrives", () => {
    const result = filterExternalCandidate(
      {
        sourceTier: "b",
        sourceId: "hot-search",
        title: "热榜：某连锁疑似下调团购价格",
        summary: "只能作为线索，等待更强来源确认。",
        publishedAt: "2026-04-03T09:20:00+08:00",
      },
      {
        now: NOW,
        freshnessHours: 72,
      },
    );

    expect(result.decision).toEqual({
      accepted: true,
      stage: "lead",
      reason: "needs-source-confirmation",
    });
  });
});
