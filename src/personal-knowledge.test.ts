import { describe, expect, test } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildPersonalKnowledgeIndex,
  chunkPersonalKnowledgeText,
  isSupportedPersonalKnowledgeSource,
  normalizePersonalKnowledgeTitle,
  renderPersonalKnowledgeAnswer,
  searchPersonalKnowledgeChunks,
} from "./personal-knowledge.js";

describe("personal knowledge", () => {
  test("accepts book-like sources and skips unrelated binaries", () => {
    expect(isSupportedPersonalKnowledgeSource("华与华超级符号案例集.pdf")).toBe(true);
    expect(isSupportedPersonalKnowledgeSource("华与华方法.epub")).toBe(true);
    expect(isSupportedPersonalKnowledgeSource("营销方法论.md")).toBe(true);
    expect(isSupportedPersonalKnowledgeSource("荷小悦_品牌策划全案.docx")).toBe(true);
    expect(isSupportedPersonalKnowledgeSource("荷小悦-项目介绍.pptx")).toBe(true);
    expect(isSupportedPersonalKnowledgeSource("按摩服务行业_消费者需求逆推图.html")).toBe(true);
    expect(isSupportedPersonalKnowledgeSource("TVBox_takagen99.apk")).toBe(false);
  });

  test("normalizes noisy local book filenames into readable titles", () => {
    expect(
      normalizePersonalKnowledgeTitle(
        "华与华超级符号案例集_3_华杉；华楠_(华杉；华楠)_(Z-Library).pdf",
      ),
    ).toBe("华与华超级符号案例集 3 华杉；华楠");
  });

  test("chunks and ranks Chinese marketing knowledge by query overlap", () => {
    const chunks = chunkPersonalKnowledgeText({
      domain: "marketing",
      sourceId: "huayuhua-super-symbol",
      title: "华与华超级符号案例集",
      relativePath: "knowledge/marketing/raw/华与华超级符号案例集.pdf",
      text: [
        "超级符号不是装饰，而是降低传播成本的品牌资产。门店招牌、包装、话语和员工动作都要统一。",
        "增长黑客强调用实验找到高转化路径，通过数据反馈不断优化获客和留存。",
      ].join("\n\n"),
      chunkSize: 34,
      overlap: 8,
    });

    const results = searchPersonalKnowledgeChunks(chunks, "门店品牌超级符号怎么设计", {
      topK: 1,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe("华与华超级符号案例集");
    expect(results[0]?.score).toBeGreaterThan(0);
    expect(results[0]?.text).toContain("超级符号");
  });

  test("renders a grounded answer with citations instead of pretending unsupported knowledge", () => {
    const chunks = chunkPersonalKnowledgeText({
      domain: "marketing",
      sourceId: "story-copywriting",
      title: "爆款文案写作指南",
      relativePath: "knowledge/marketing/raw/爆款文案写作指南.pdf",
      text: "故事营销要把用户放进具体场景，用冲突、选择和结果推动行动。门店活动文案要先讲顾客问题，再讲解决方案。",
      chunkSize: 80,
      overlap: 0,
    });
    const answer = renderPersonalKnowledgeAnswer({
      question: "怎么写门店活动文案",
      domain: "marketing",
      results: searchPersonalKnowledgeChunks(chunks, "怎么写门店活动文案", { topK: 3 }),
    });

    expect(answer.answer).toContain("基于 marketing 书库");
    expect(answer.answer).toContain("可执行");
    expect(answer.citations[0]?.title).toBe("爆款文案写作指南");
    expect(answer.citations[0]?.snippet.length).toBeLessThanOrEqual(180);
  });

  test("indexes local symlinked book files as domain sources", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "htops-knowledge-"));
    const sourceDir = path.join(rootDir, "source");
    const rawDir = path.join(rootDir, "knowledge", "brand", "raw");
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.mkdir(rawDir, { recursive: true });
    const sourcePath = path.join(sourceDir, "华与华超级符号案例集.md");
    const linkedPath = path.join(rawDir, "华与华超级符号案例集.md");
    await fs.writeFile(
      sourcePath,
      "超级符号是降低传播成本的品牌资产，要落到门头、包装和员工动作。",
      "utf8",
    );
    await fs.symlink(sourcePath, linkedPath);

    const index = await buildPersonalKnowledgeIndex({
      rootDir,
      rawDir,
      domain: "brand",
      chunkSize: 60,
      overlap: 0,
    });

    expect(index.sources).toHaveLength(1);
    expect(index.sources[0]?.domain).toBe("brand");
    expect(index.chunks[0]?.text).toContain("超级符号");

    await fs.rm(rootDir, { recursive: true, force: true });
  });

  test("recursively indexes project knowledge files", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "htops-hxy-knowledge-"));
    const rawDir = path.join(rootDir, "knowledge", "hxy", "raw");
    await fs.mkdir(path.join(rawDir, "荷小悦资料", "研究资料"), { recursive: true });
    await fs.writeFile(
      path.join(rawDir, "荷小悦资料", "研究资料", "荷小悦_品牌策划全案.docx"),
      "荷小悦要做社区女性按摩理疗小店，核心是小店模型、产品结构和连锁复制。",
      "utf8",
    );

    const index = await buildPersonalKnowledgeIndex({
      rootDir,
      rawDir,
      domain: "hxy",
      readSourceText: async (filePath) => await fs.readFile(filePath, "utf8"),
    });

    expect(index.sources).toHaveLength(1);
    expect(index.sources[0]?.relativePath).toContain("荷小悦资料/研究资料/荷小悦_品牌策划全案.docx");
    expect(index.chunks[0]?.domain).toBe("hxy");
    expect(index.chunks[0]?.text).toContain("社区女性按摩理疗小店");

    await fs.rm(rootDir, { recursive: true, force: true });
  });
});
