import { THEME_LABELS, type ExternalThemeKey } from "./classify.js";

export type RenderExternalBriefItemInput = {
  rank: number;
  title: string;
  theme: string;
  publishedAt: string;
  sourceLabels: string[];
  summary: string;
  whyItMatters: string;
};

export type RenderExternalBriefIssueInput = {
  issueDate: string;
  topic: string;
  overview?: string;
  items: RenderExternalBriefItemInput[];
};

function resolveThemeLabel(theme: string): string {
  return THEME_LABELS[theme as ExternalThemeKey] ?? theme;
}

function formatLocalTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return value;
  }
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    hour12: false,
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = formatter.formatToParts(new Date(timestamp));
  const resolved = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  ) as Record<string, string>;
  return `${resolved.year}-${resolved.month}-${resolved.day} ${resolved.hour}:${resolved.minute}`;
}

function groupHeading(theme: string): string {
  return `## ${resolveThemeLabel(theme)}`;
}

export function renderExternalBriefItem(input: RenderExternalBriefItemInput): string {
  return [
    `${input.rank}. ${input.title}`,
    `标签：${resolveThemeLabel(input.theme)}`,
    `时间：${formatLocalTimestamp(input.publishedAt)}`,
    `来源：${input.sourceLabels.join("、") || "-"}`,
    `摘要：${input.summary.trim()}`,
    `经营提示：${input.whyItMatters.trim()}`,
  ].join("\n");
}

export function renderExternalBriefIssue(input: RenderExternalBriefIssueInput): string {
  const sections: string[] = [input.topic, `日期：${input.issueDate}`];
  if (input.overview?.trim()) {
    sections.push(`今日判断：${input.overview.trim()}`);
  }

  let currentTheme = "";
  for (const item of input.items) {
    if (item.theme !== currentTheme) {
      currentTheme = item.theme;
      sections.push(groupHeading(item.theme));
    }
    sections.push(renderExternalBriefItem(item));
  }

  return sections.join("\n\n");
}
