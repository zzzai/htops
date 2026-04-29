import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type RasterizeCommandRunner = (
  argv: string[],
  options: {
    timeoutMs: number;
    cwd?: string;
    env?: Record<string, string | undefined>;
  },
) => Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}>;

type PosterSectionRow = {
  title: string;
  detail?: string;
};

const POSTER_WIDTH = 1080;
const POSTER_HEIGHT = 2300;
const CARD_X = 52;
const CARD_WIDTH = POSTER_WIDTH - CARD_X * 2;

const ASK_ROWS: PosterSectionRow[] = [
  { title: "盘子有没有问题", detail: "先看这家店最近稳不稳" },
  { title: "近7天有没有风险", detail: "先看这周哪里在掉" },
  { title: "该先抓什么", detail: "可以直接要经营建议" },
  { title: "营收、点钟率、钟效", detail: "关键指标可以单独查" },
];

const EXAMPLE_ROWS: PosterSectionRow[] = [
  { title: "迎宾店近30天盘子有没有问题" },
  { title: "义乌店近7天有没有风险" },
  { title: "华美店近30天给我经营建议" },
  { title: "锦苑店昨天点钟率多少" },
  { title: "园中园店昨天钟效多少" },
];

const NOTICE_ROWS: PosterSectionRow[] = [
  { title: "说清门店", detail: "比如：迎宾店、义乌店" },
  { title: "说清时间", detail: "比如：昨天、今天、本周" },
  { title: "说清指标", detail: "比如：营收、客流、点钟率" },
  { title: "一次只问一件事", detail: "这样回复更快，也更准" },
  { title: "群里先点机器人，再发问题" },
];

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function renderAskRows(startY: number): string[] {
  return ASK_ROWS.flatMap((row, index) => {
    const rowY = startY + index * 82;
    return [
      `<rect x="84" y="${rowY}" width="912" height="72" rx="24" fill="#F8FAFF"/>`,
      `<circle cx="124" cy="${rowY + 36}" r="16" fill="#2563EB"/>`,
      `<text x="124" y="${rowY + 42}" text-anchor="middle" class="row-index">${index + 1}</text>`,
      `<text x="156" y="${rowY + 32}" class="row-title">${escapeXml(row.title)}</text>`,
      row.detail ? `<text x="156" y="${rowY + 56}" class="row-detail">${escapeXml(row.detail)}</text>` : "",
    ];
  });
}

function renderExampleRows(startY: number): string[] {
  return EXAMPLE_ROWS.flatMap((row, index) => {
    const rowY = startY + index * 104;
    return [
      `<rect x="84" y="${rowY}" width="912" height="90" rx="28" fill="${index % 2 === 0 ? "#EEF4FF" : "#F8FAFF"}"/>`,
      `<text x="114" y="${rowY + 34}" class="example-label">直接照着发</text>`,
      `<text x="114" y="${rowY + 66}" class="example-text">${escapeXml(row.title)}</text>`,
    ];
  });
}

function renderNoticeRows(startY: number): string[] {
  return NOTICE_ROWS.flatMap((row, index) => {
    const rowY = startY + index * 92;
    return [
      `<rect x="84" y="${rowY}" width="912" height="74" rx="24" fill="#FFFFFF"/>`,
      `<circle cx="124" cy="${rowY + 37}" r="16" fill="#DBEAFE"/>`,
      `<text x="124" y="${rowY + 43}" text-anchor="middle" class="notice-index">${index + 1}</text>`,
      `<text x="158" y="${rowY + 34}" class="notice-title">${escapeXml(row.title)}</text>`,
      row.detail ? `<text x="158" y="${rowY + 58}" class="notice-detail">${escapeXml(row.detail)}</text>` : "",
    ];
  });
}

export function renderStoreManagerBotGuidePosterSvg(): string {
  const svg: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${POSTER_WIDTH}" height="${POSTER_HEIGHT}" viewBox="0 0 ${POSTER_WIDTH} ${POSTER_HEIGHT}" fill="none">`,
    `<defs>
      <linearGradient id="pageBg" x1="0" y1="0" x2="1080" y2="2300" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#F7FAFF"/>
        <stop offset="100%" stop-color="#EEF2F8"/>
      </linearGradient>
      <linearGradient id="heroBg" x1="52" y1="56" x2="1028" y2="236" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#0F172A"/>
        <stop offset="100%" stop-color="#1D4ED8"/>
      </linearGradient>
    </defs>`,
    `<rect width="${POSTER_WIDTH}" height="${POSTER_HEIGHT}" fill="url(#pageBg)"/>`,
    `<circle cx="900" cy="180" r="170" fill="#DBEAFE" opacity="0.55"/>`,
    `<circle cx="180" cy="2200" r="180" fill="#E0E7FF" opacity="0.5"/>`,
    `<style>
      text {
        font-family: "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif;
      }
      .hero-badge { font-size: 24px; font-weight: 700; fill: #DBEAFE; }
      .hero-title { font-size: 52px; font-weight: 700; fill: #FFFFFF; }
      .hero-subtitle { font-size: 28px; font-weight: 500; fill: rgba(255, 255, 255, 0.88); }
      .section-kicker { font-size: 20px; font-weight: 700; fill: #2563EB; }
      .section-title { font-size: 42px; font-weight: 700; fill: #0F172A; }
      .section-desc { font-size: 24px; font-weight: 500; fill: #64748B; }
      .row-index { font-size: 20px; font-weight: 700; fill: #FFFFFF; }
      .row-title { font-size: 27px; font-weight: 700; fill: #0F172A; }
      .row-detail { font-size: 19px; font-weight: 500; fill: #64748B; }
      .example-label { font-size: 20px; font-weight: 700; fill: #2563EB; }
      .example-text { font-size: 28px; font-weight: 700; fill: #0F172A; }
      .notice-index { font-size: 18px; font-weight: 700; fill: #1D4ED8; }
      .notice-title { font-size: 28px; font-weight: 700; fill: #0F172A; }
      .notice-detail { font-size: 20px; font-weight: 500; fill: #64748B; }
      .footer-note { font-size: 24px; font-weight: 700; fill: #1D4ED8; }
      .footer-subnote { font-size: 21px; font-weight: 500; fill: #64748B; }
    </style>`,
    `<rect x="${CARD_X}" y="56" width="${CARD_WIDTH}" height="182" rx="36" fill="url(#heroBg)"/>`,
    `<text x="96" y="112" class="hero-badge">门店看数，先看这张图</text>`,
    `<text x="96" y="168" class="hero-title">店长企微问数教程</text>`,
    `<text x="96" y="210" class="hero-subtitle">只看三件事：可以问什么、怎么问、注意什么</text>`,
    `<rect x="${CARD_X}" y="278" width="${CARD_WIDTH}" height="508" rx="34" fill="#FFFFFF"/>`,
    `<text x="84" y="332" class="section-kicker">一</text>`,
    `<text x="84" y="378" class="section-title">可以问什么</text>`,
    `<text x="84" y="414" class="section-desc">先看这 4 类，不要空问。</text>`,
    ...renderAskRows(446),
    `<rect x="${CARD_X}" y="826" width="${CARD_WIDTH}" height="706" rx="34" fill="#FFFFFF"/>`,
    `<text x="84" y="880" class="section-kicker">二</text>`,
    `<text x="84" y="926" class="section-title">怎么问</text>`,
    `<text x="84" y="962" class="section-desc">下面这 5 句，5 家店都不一样，直接照着发。</text>`,
    ...renderExampleRows(1000),
    `<rect x="${CARD_X}" y="1572" width="${CARD_WIDTH}" height="588" rx="34" fill="#F8FAFF"/>`,
    `<text x="84" y="1626" class="section-kicker">三</text>`,
    `<text x="84" y="1672" class="section-title">注意事项</text>`,
    `<text x="84" y="1708" class="section-desc">问得越清楚，回复越快，结果也越准。</text>`,
    ...renderNoticeRows(1744),
    `<rect x="84" y="2188" width="912" height="76" rx="24" fill="#FFFFFF"/>`,
    `<text x="116" y="2232" class="footer-note">先把门店、时间、指标说清楚，再发问题。</text>`,
    `</svg>`,
  ];

  return svg.join("");
}

export async function buildStoreManagerBotGuidePosterImage(params: {
  outputDir: string;
  runCommandWithTimeout: RasterizeCommandRunner;
  chromeBinary?: string;
}): Promise<string> {
  fs.mkdirSync(params.outputDir, { recursive: true });
  const svgPath = path.join(params.outputDir, "store-manager-bot-guide-poster.svg");
  const pngPath = path.join(params.outputDir, "store-manager-bot-guide-poster.png");
  fs.writeFileSync(svgPath, renderStoreManagerBotGuidePosterSvg(), "utf8");

  const chromeBinary =
    params.chromeBinary ||
    process.env.GOOGLE_CHROME_BIN ||
    process.env.CHROME_BIN ||
    "/usr/bin/google-chrome-stable";
  const chromeArgs = [
    chromeBinary,
    "--headless=new",
    "--disable-gpu",
    ...(typeof process.getuid === "function" && process.getuid() === 0 ? ["--no-sandbox"] : []),
    `--screenshot=${pngPath}`,
    `--window-size=${POSTER_WIDTH},${POSTER_HEIGHT}`,
    pathToFileURL(svgPath).toString(),
  ];

  const result = await params.runCommandWithTimeout(chromeArgs, {
    timeoutMs: 120_000,
    cwd: process.cwd(),
  });

  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || `store manager guide rasterize failed with code ${result.code}`);
  }

  if (!fs.existsSync(pngPath)) {
    throw new Error(`store manager guide rasterize did not produce ${pngPath}`);
  }

  return pngPath;
}
