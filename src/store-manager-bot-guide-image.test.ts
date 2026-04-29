import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildStoreManagerBotGuidePosterImage,
  renderStoreManagerBotGuidePosterSvg,
} from "./store-manager-bot-guide-image.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) {
      continue;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("store-manager-bot-guide-image", () => {
  it("renders the mobile poster with the required chinese guide sections", () => {
    const svg = renderStoreManagerBotGuidePosterSvg();

    expect(svg).toContain("店长企微问数教程");
    expect(svg).toContain("可以问什么");
    expect(svg).toContain("怎么问");
    expect(svg).toContain("注意事项");
    expect(svg).toContain("盘子有没有问题");
    expect(svg).toContain("近7天有没有风险");
    expect(svg).toContain("该先抓什么");
    expect(svg).toContain("营收、点钟率、钟效");
    expect(svg).toContain("迎宾店近30天盘子有没有问题");
    expect(svg).toContain("义乌店近7天有没有风险");
    expect(svg).toContain("华美店近30天给我经营建议");
    expect(svg).toContain("锦苑店昨天点钟率多少");
    expect(svg).toContain("园中园店昨天钟效多少");
    expect(svg).not.toContain("迎宾店昨天日报");
    expect(svg).not.toContain("迎宾店高价值待唤回名单");
    expect(svg).not.toContain("高价值待唤回名单");
    expect(svg).not.toContain("营收、客流、点钟率、加钟率");
    expect(svg).toContain("群里先点机器人，再发问题");
  });

  it("writes a png through headless chrome and returns the generated file path", async () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "store-manager-guide-image-"));
    tempDirs.push(outputDir);

    const runCommandWithTimeout = vi.fn(async (argv: string[]) => {
      const screenshotArg = argv.find((value) => value.startsWith("--screenshot="));
      const outputPath = screenshotArg?.slice("--screenshot=".length);
      if (outputPath) {
        fs.writeFileSync(outputPath, "png");
      }
      return {
        code: 0,
        stdout: "",
        stderr: "",
      };
    });

    const imagePath = await buildStoreManagerBotGuidePosterImage({
      outputDir,
      runCommandWithTimeout,
    });

    expect(imagePath).toBe(path.join(outputDir, "store-manager-bot-guide-poster.png"));
    expect(fs.existsSync(imagePath)).toBe(true);
    expect(runCommandWithTimeout).toHaveBeenCalledTimes(1);
    expect(runCommandWithTimeout.mock.calls[0]?.[0]?.[0]).toContain("google-chrome");
    expect(runCommandWithTimeout.mock.calls[0]?.[0]).toContain("--no-sandbox");
    expect(runCommandWithTimeout.mock.calls[0]?.[0]).toContain(`--screenshot=${imagePath}`);
  });
});
