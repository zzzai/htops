import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export type PersonalKnowledgeDomain = "brand" | "marketing" | "management" | "book" | "hxy";

export type PersonalKnowledgeSource = {
  sourceId: string;
  domain: PersonalKnowledgeDomain | string;
  title: string;
  relativePath: string;
  fileName: string;
  fileSize: number;
  updatedAt: string;
};

export type PersonalKnowledgeChunk = {
  chunkId: string;
  sourceId: string;
  domain: string;
  title: string;
  relativePath: string;
  chunkIndex: number;
  text: string;
  keywords: string[];
};

export type PersonalKnowledgeSearchResult = PersonalKnowledgeChunk & {
  score: number;
};

export type PersonalKnowledgeIndex = {
  version: "personal-knowledge-index.v1";
  generatedAt: string;
  rootDir: string;
  rawDir: string;
  domains: string[];
  sources: PersonalKnowledgeSource[];
  chunks: PersonalKnowledgeChunk[];
  skippedFiles: Array<{
    fileName: string;
    reason: string;
  }>;
};

export type PersonalKnowledgeCitation = {
  sourceId: string;
  title: string;
  relativePath: string;
  chunkIndex: number;
  score: number;
  snippet: string;
};

export type PersonalKnowledgeRenderedAnswer = {
  answer: string;
  citations: PersonalKnowledgeCitation[];
};

const SUPPORTED_SOURCE_EXTENSIONS = new Set([
  ".pdf",
  ".epub",
  ".txt",
  ".md",
  ".markdown",
  ".docx",
  ".html",
  ".htm",
  ".pptx",
]);
const CHINESE_STOPWORDS = new Set([
  "一个",
  "什么",
  "如何",
  "怎么",
  "怎样",
  "是否",
  "可以",
  "应该",
  "需要",
  "通过",
  "进行",
  "这个",
  "那个",
  "以及",
  "如果",
  "我们",
  "你们",
  "他们",
  "门店",
  "品牌",
]);
const ASCII_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "into",
  "your",
  "you",
  "are",
  "how",
  "what",
  "why",
]);

function sha1(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

export function isSupportedPersonalKnowledgeSource(fileName: string): boolean {
  return SUPPORTED_SOURCE_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

export function normalizePersonalKnowledgeTitle(fileName: string): string {
  const extension = path.extname(fileName);
  const withoutExtension = extension ? fileName.slice(0, -extension.length) : fileName;
  const cleaned = withoutExtension
    .replace(/[_+]+/gu, " ")
    .replace(/\([^)]*(?:Z-Library|z-library)[^)]*\)/giu, " ")
    .replace(/（[^）]*(?:Z-Library|z-library)[^）]*）/giu, " ")
    .replace(/\[[^\]]*(?:Z-Library|z-library)[^\]]*\]/giu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const duplicateParenMatch = /^(?<prefix>.+?)\s*[\(（](?<inner>[^()（）]+)[\)）]$/u.exec(cleaned);
  if (duplicateParenMatch?.groups) {
    const prefix = duplicateParenMatch.groups.prefix.trim();
    const inner = duplicateParenMatch.groups.inner.trim();
    if (prefix.endsWith(inner)) {
      return prefix;
    }
  }
  return cleaned;
}

export function extractPersonalKnowledgeKeywords(value: string): string[] {
  const normalized = value.toLowerCase();
  const tokens = new Set<string>();
  for (const match of normalized.matchAll(/[\p{Script=Han}]{2,}|[a-z0-9][a-z0-9-]{2,}/giu)) {
    const token = match[0].trim();
    if (!token) {
      continue;
    }
    if (/^[\p{Script=Han}]+$/u.test(token)) {
      if (CHINESE_STOPWORDS.has(token)) {
        continue;
      }
      tokens.add(token);
      for (let index = 0; index <= token.length - 2; index += 1) {
        const bigram = token.slice(index, index + 2);
        if (!CHINESE_STOPWORDS.has(bigram)) {
          tokens.add(bigram);
        }
      }
      continue;
    }
    if (!ASCII_STOPWORDS.has(token)) {
      tokens.add(token);
    }
  }
  return Array.from(tokens);
}

export function chunkPersonalKnowledgeText(params: {
  domain: string;
  sourceId: string;
  title: string;
  relativePath: string;
  text: string;
  chunkSize?: number;
  overlap?: number;
}): PersonalKnowledgeChunk[] {
  const normalized = normalizeWhitespace(params.text);
  if (!normalized) {
    return [];
  }
  const chunkSize = Math.max(60, params.chunkSize ?? 900);
  const overlap = Math.max(0, Math.min(params.overlap ?? 120, Math.floor(chunkSize / 2)));
  const chunks: PersonalKnowledgeChunk[] = [];
  let start = 0;
  while (start < normalized.length) {
    const hardEnd = Math.min(start + chunkSize, normalized.length);
    let end = hardEnd;
    if (hardEnd < normalized.length) {
      const punctuationBoundary = Math.max(
        normalized.lastIndexOf("。", hardEnd),
        normalized.lastIndexOf("；", hardEnd),
        normalized.lastIndexOf("！", hardEnd),
        normalized.lastIndexOf("？", hardEnd),
        normalized.lastIndexOf(".", hardEnd),
      );
      if (punctuationBoundary > start + Math.floor(chunkSize * 0.55)) {
        end = punctuationBoundary + 1;
      }
    }
    const text = normalized.slice(start, end).trim();
    if (text) {
      const chunkIndex = chunks.length;
      chunks.push({
        chunkId: sha1(`${params.sourceId}:${chunkIndex}:${text.slice(0, 120)}`),
        sourceId: params.sourceId,
        domain: params.domain,
        title: params.title,
        relativePath: params.relativePath,
        chunkIndex,
        text,
        keywords: extractPersonalKnowledgeKeywords(`${params.title} ${text}`),
      });
    }
    if (end >= normalized.length) {
      break;
    }
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

export function searchPersonalKnowledgeChunks(
  chunks: PersonalKnowledgeChunk[],
  query: string,
  options?: {
    domain?: string;
    topK?: number;
  },
): PersonalKnowledgeSearchResult[] {
  const queryKeywords = extractPersonalKnowledgeKeywords(query);
  if (queryKeywords.length === 0) {
    return [];
  }
  const querySet = new Set(queryKeywords);
  const scored: PersonalKnowledgeSearchResult[] = [];
  for (const chunk of chunks) {
    if (options?.domain && chunk.domain !== options.domain) {
      continue;
    }
    let score = 0;
    const uniqueChunkKeywords = new Set(chunk.keywords);
    for (const keyword of querySet) {
      if (uniqueChunkKeywords.has(keyword)) {
        score += keyword.length >= 3 ? 2 : 1;
      }
      if (chunk.title.includes(keyword)) {
        score += 1;
      }
    }
    if (score > 0) {
      scored.push({
        ...chunk,
        score,
      });
    }
  }
  return scored
    .sort((left, right) => right.score - left.score || left.chunkIndex - right.chunkIndex)
    .slice(0, options?.topK ?? 6);
}

export function renderPersonalKnowledgeAnswer(params: {
  question: string;
  domain: string;
  results: PersonalKnowledgeSearchResult[];
}): PersonalKnowledgeRenderedAnswer {
  const citations = params.results.slice(0, 5).map((result) => ({
    sourceId: result.sourceId,
    title: result.title,
    relativePath: result.relativePath,
    chunkIndex: result.chunkIndex,
    score: result.score,
    snippet: result.text.slice(0, 180),
  }));

  if (citations.length === 0) {
    return {
      answer: [
        `当前 ${params.domain} 书库没有检索到足够依据。`,
        "建议先补充对应书籍，或把问题拆成更明确的概念、场景、动作目标。",
      ].join("\n"),
      citations: [],
    };
  }

  const evidenceLines = params.results.slice(0, 3).map((result, index) => {
    const actionHint = result.text.slice(0, 120);
    return `${index + 1}. 《${result.title}》相关片段提示：${actionHint}`;
  });
  return {
    answer: [
      `基于 ${params.domain} 书库，当前问题可以先按“方法论 -> 场景 -> 动作 -> 反馈”处理。`,
      "",
      "可执行建议：",
      ...evidenceLines,
      "",
      "落地时不要只复述书中概念，要把它转成目标客群、触点、话术、活动机制和验证指标。",
    ].join("\n"),
    citations,
  };
}

async function readTextSource(filePath: string): Promise<string> {
  return await fs.readFile(filePath, "utf8");
}

async function collectPersonalKnowledgeFiles(rawDir: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN"))) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (entry.isFile() || entry.isSymbolicLink()) {
        files.push(absolutePath);
      }
    }
  }
  await visit(rawDir);
  return files;
}

export async function buildPersonalKnowledgeIndex(params: {
  rootDir: string;
  rawDir: string;
  domain: string;
  readSourceText?: (filePath: string) => Promise<string>;
  now?: () => Date;
  chunkSize?: number;
  overlap?: number;
}): Promise<PersonalKnowledgeIndex> {
  const readSourceTextFn = params.readSourceText ?? readTextSource;
  const generatedAt = (params.now ?? (() => new Date()))().toISOString();
  const files = await collectPersonalKnowledgeFiles(params.rawDir);
  const sources: PersonalKnowledgeSource[] = [];
  const chunks: PersonalKnowledgeChunk[] = [];
  const skippedFiles: PersonalKnowledgeIndex["skippedFiles"] = [];

  for (const absolutePath of files) {
    const fileName = path.basename(absolutePath);
    if (!isSupportedPersonalKnowledgeSource(fileName)) {
      skippedFiles.push({
        fileName: path.relative(params.rawDir, absolutePath),
        reason: "unsupported_file_type",
      });
      continue;
    }
    const stats = await fs.stat(absolutePath);
    const relativePath = path.relative(params.rootDir, absolutePath);
    const title = normalizePersonalKnowledgeTitle(fileName);
    const sourceId = sha1(`${params.domain}:${relativePath}:${stats.size}`);
    let text = "";
    try {
      text = await readSourceTextFn(absolutePath);
    } catch {
      skippedFiles.push({
        fileName: path.relative(params.rawDir, absolutePath),
        reason: "text_extraction_failed",
      });
      continue;
    }
    const sourceChunks = chunkPersonalKnowledgeText({
      domain: params.domain,
      sourceId,
      title,
      relativePath,
      text,
      chunkSize: params.chunkSize,
      overlap: params.overlap,
    });
    if (sourceChunks.length === 0) {
      skippedFiles.push({ fileName: path.relative(params.rawDir, absolutePath), reason: "empty_text" });
      continue;
    }
    sources.push({
      sourceId,
      domain: params.domain,
      title,
      relativePath,
      fileName,
      fileSize: stats.size,
      updatedAt: stats.mtime.toISOString(),
    });
    chunks.push(...sourceChunks);
  }

  return {
    version: "personal-knowledge-index.v1",
    generatedAt,
    rootDir: params.rootDir,
    rawDir: params.rawDir,
    domains: [params.domain],
    sources,
    chunks,
    skippedFiles,
  };
}

export async function writePersonalKnowledgeIndex(
  index: PersonalKnowledgeIndex,
  outputPath: string,
): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
}

export async function readPersonalKnowledgeIndex(
  indexPath: string,
): Promise<PersonalKnowledgeIndex> {
  const raw = await fs.readFile(indexPath, "utf8");
  return JSON.parse(raw) as PersonalKnowledgeIndex;
}
