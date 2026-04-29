import type { CommandRunner } from "../notify.js";
import type { HetangLogger, HetangOpsConfig } from "../types.js";
import { runAiLaneJsonTask, runCustomerGrowthAiJsonTask } from "../customer-growth/ai/client.js";

const XIAOHONGSHU_URL_PATTERN =
  /https?:\/\/(?:www\.)?(?:xiaohongshu\.com\/[^\s"'<>]+|xhslink\.com\/[^\s"'<>]+)/giu;
const TRAILING_URL_PUNCTUATION = /[),.;!?，。；！？、】【』」]+$/gu;

type XiaohongshuAdapterRow = {
  note_id?: unknown;
  noteId?: unknown;
  resolved_url?: unknown;
  resolvedUrl?: unknown;
  title?: unknown;
  author?: unknown;
  published_at?: unknown;
  publishedAt?: unknown;
  content?: unknown;
  tags?: unknown;
  like_count?: unknown;
  likeCount?: unknown;
  collect_count?: unknown;
  collectCount?: unknown;
  comment_count?: unknown;
  commentCount?: unknown;
};

type NormalizedXiaohongshuNote = {
  noteId?: string;
  resolvedUrl?: string;
  title: string;
  author?: string;
  publishedAt?: string;
  content: string;
  tags: string[];
  likeCount?: string;
  collectCount?: string;
  commentCount?: string;
};

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => optionalString(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function shortenText(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function normalizeAdapterPayload(stdout: string): NormalizedXiaohongshuNote | null {
  if (!stdout.trim()) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  const row = Array.isArray(parsed)
    ? (parsed[0] as XiaohongshuAdapterRow | undefined)
    : ((parsed as XiaohongshuAdapterRow | undefined) ?? undefined);
  if (!row || typeof row !== "object") {
    return null;
  }
  const title = optionalString(row.title) ?? undefined;
  const content = optionalString(row.content) ?? undefined;
  if (!title && !content) {
    return null;
  }
  return {
    noteId: optionalString(row.note_id) ?? optionalString(row.noteId),
    resolvedUrl: optionalString(row.resolved_url) ?? optionalString(row.resolvedUrl),
    title: title ?? "未命名笔记",
    author: optionalString(row.author),
    publishedAt: optionalString(row.published_at) ?? optionalString(row.publishedAt),
    content: content ?? "",
    tags: normalizeStringList(row.tags),
    likeCount: optionalString(row.like_count) ?? optionalString(row.likeCount),
    collectCount: optionalString(row.collect_count) ?? optionalString(row.collectCount),
    commentCount: optionalString(row.comment_count) ?? optionalString(row.commentCount),
  };
}

function buildVisibleEngagementSummary(note: NormalizedXiaohongshuNote): string | null {
  const parts = [
    note.likeCount ? `点赞 ${note.likeCount}` : null,
    note.collectCount ? `收藏 ${note.collectCount}` : null,
    note.commentCount ? `评论 ${note.commentCount}` : null,
  ].filter((entry): entry is string => Boolean(entry));
  if (parts.length === 0) {
    return null;
  }
  return parts.join(" / ");
}

function buildDeterministicReply(
  note: NormalizedXiaohongshuNote,
  maxContentChars: number,
): string {
  const lines = ["已读完这篇小红书笔记，摘要如下：", `标题：《${note.title}》`];
  if (note.author) {
    lines.push(`作者：${note.author}`);
  }
  if (note.publishedAt) {
    lines.push(`发布时间：${note.publishedAt}`);
  }
  if (note.tags.length > 0) {
    lines.push(`标签：${note.tags.join("、")}`);
  }
  if (note.content.trim()) {
    lines.push(`内容摘要：${shortenText(note.content, maxContentChars)}`);
  }
  const engagementSummary = buildVisibleEngagementSummary(note);
  if (engagementSummary) {
    lines.push(`可见互动：${engagementSummary}`);
  }
  if (note.resolvedUrl) {
    lines.push(`原链接：${note.resolvedUrl}`);
  }
  return lines.join("\n");
}

async function buildAiEnhancedReply(params: {
  config: HetangOpsConfig;
  logger: HetangLogger;
  note: NormalizedXiaohongshuNote;
}): Promise<string | null> {
  const prompt = [
    "请严格输出一个 JSON 对象，字段只允许出现：summary, keyPoints, reply。",
    "要求：",
    "1. summary 用 1-2 句中文总结这篇笔记主旨。",
    "2. keyPoints 输出 0-3 条核心要点。",
    "3. reply 输出一段适合企业微信里转述的自然中文回复。",
    "4. 不要编造未出现的门店信息、价格、疗效或作者背景。",
    JSON.stringify(params.note, null, 2),
  ].join("\n");
  const aiSummary = params.config.aiLanes["cheap-summary"]
    ? await runAiLaneJsonTask<{
        summary?: string;
        keyPoints?: string[];
        reply?: string;
      }>({
        config: params.config,
        laneId: "cheap-summary",
        logger: params.logger,
        warnLabel: "cheap summary ai for xiaohongshu",
        systemPrompt:
          "你是企业微信里的内容速读助手。你只能根据给定的小红书笔记事实生成中文摘要，不能编造没有出现的体验、价格、品牌结论或营销承诺。",
        userPrompt: prompt,
      })
    : await runCustomerGrowthAiJsonTask<{
        summary?: string;
        keyPoints?: string[];
        reply?: string;
      }>({
        config: params.config,
        module: "followupSummarizer",
        logger: params.logger,
        systemPrompt:
          "你是企业微信里的内容速读助手。你只能根据给定的小红书笔记事实生成中文摘要，不能编造没有出现的体验、价格、品牌结论或营销承诺。",
        userPrompt: prompt,
      });
  const summary = optionalString(aiSummary?.summary);
  const reply = optionalString(aiSummary?.reply);
  const keyPoints = normalizeStringList(aiSummary?.keyPoints).slice(0, 3);
  if (!summary && !reply) {
    return null;
  }

  const lines = ["已读完这篇小红书笔记。", `标题：《${params.note.title}》`];
  if (params.note.author) {
    lines.push(`作者：${params.note.author}`);
  }
  if (summary) {
    lines.push(`AI摘要：${summary}`);
  }
  if (keyPoints.length > 0) {
    lines.push(`要点：${keyPoints.join("；")}`);
  }
  if (reply) {
    lines.push(`建议转述：${reply}`);
  }
  if (params.note.resolvedUrl) {
    lines.push(`原链接：${params.note.resolvedUrl}`);
  }
  return lines.join("\n");
}

function resolveSidecarFailureMessage(stderr: string): string {
  const normalized = stderr.trim().toLowerCase();
  if (normalized.includes("command not found") || normalized.includes("enoent")) {
    return "刚才那条小红书链接我收到了，但当前小红书读取 sidecar 还没安装完成，请联系管理员补装 AutoCLI。";
  }
  if (
    normalized.includes("login") ||
    normalized.includes("cookie") ||
    normalized.includes("extension") ||
    normalized.includes("daemon") ||
    normalized.includes("not connected")
  ) {
    return "刚才那条小红书链接暂时没读出来，可能是 Chrome 扩展未连通或登录态失效，请稍后重试。";
  }
  return "刚才那条小红书链接读取失败了，可能是站点侧返回异常或浏览器态暂不可用，请稍后再试。";
}

export function extractFirstXiaohongshuUrl(text: string): string | null {
  const matches = text.match(XIAOHONGSHU_URL_PATTERN);
  if (!matches || matches.length === 0) {
    return null;
  }
  const first = matches[0]?.trim().replace(TRAILING_URL_PUNCTUATION, "");
  return first && first.length > 0 ? first : null;
}

export class HetangXiaohongshuLinkService {
  constructor(
    private readonly deps: {
      config: HetangOpsConfig;
      runCommandWithTimeout: CommandRunner;
      logger: HetangLogger;
    },
  ) {}

  canHandleText(text: string): boolean {
    return (
      this.deps.config.inboundLinkReaders.xiaohongshu.enabled &&
      extractFirstXiaohongshuUrl(text) !== null
    );
  }

  async buildReplyForText(params: {
    requestId: string;
    text: string;
  }): Promise<string | null> {
    if (!this.deps.config.inboundLinkReaders.xiaohongshu.enabled) {
      return null;
    }
    const url = extractFirstXiaohongshuUrl(params.text);
    if (!url) {
      return null;
    }
    const linkConfig = this.deps.config.inboundLinkReaders.xiaohongshu;
    const argv = [
      linkConfig.autocliBin?.trim() || "autocli",
      "xiaohongshu",
      "read-note",
      url,
      "--format",
      "json",
    ];
    this.deps.logger.info(
      `hetang-ops: xiaohongshu sidecar request request_id=${params.requestId} url=${JSON.stringify(url)}`,
    );
    const result = await this.deps.runCommandWithTimeout(argv, {
      timeoutMs: linkConfig.timeoutMs,
      cwd: process.cwd(),
      env: {
        AUTOCLI_BROWSER_COMMAND_TIMEOUT: String(linkConfig.browserTimeoutMs),
      },
    });

    if ((result.code ?? 1) !== 0) {
      const failureMessage = resolveSidecarFailureMessage(result.stderr || result.stdout || "");
      this.deps.logger.warn(
        `hetang-ops: xiaohongshu sidecar failed request_id=${params.requestId} code=${result.code} termination=${result.termination} stderr=${JSON.stringify((result.stderr || result.stdout || "").slice(0, 400))}`,
      );
      return failureMessage;
    }

    const note = normalizeAdapterPayload(result.stdout);
    if (!note) {
      this.deps.logger.warn(
        `hetang-ops: xiaohongshu sidecar parse failed request_id=${params.requestId} stdout=${JSON.stringify(result.stdout.slice(0, 400))}`,
      );
      return "刚才那条小红书链接已经打开，但正文没有成功提取出来，请稍后再试。";
    }

    const fallbackReply = buildDeterministicReply(note, linkConfig.maxContentChars);
    const aiReply = await buildAiEnhancedReply({
      config: this.deps.config,
      logger: this.deps.logger,
      note,
    });
    return aiReply ?? fallbackReply;
  }
}
