import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import {
  buildPersonalKnowledgeIndex,
  writePersonalKnowledgeIndex,
} from "../src/personal-knowledge.js";

type Args = {
  rootDir: string;
  domain: string;
  rawDir: string;
  output: string;
  chunkSize: number;
  overlap: number;
};

function parseArgs(argv: string[]): Args {
  const rootDir = process.env.HTOPS_ROOT_DIR?.trim() || process.cwd();
  const parsed: Args = {
    rootDir,
    domain: "brand",
    rawDir: path.join(rootDir, "knowledge", "brand", "raw"),
    output: path.join(rootDir, "knowledge", "brand", "index.json"),
    chunkSize: 1200,
    overlap: 160,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    switch (current) {
      case "--domain":
        if (!next) {
          throw new Error("--domain requires a value");
        }
        parsed.domain = next;
        index += 1;
        break;
      case "--raw-dir":
        if (!next) {
          throw new Error("--raw-dir requires a value");
        }
        parsed.rawDir = path.resolve(next);
        index += 1;
        break;
      case "--output":
        if (!next) {
          throw new Error("--output requires a value");
        }
        parsed.output = path.resolve(next);
        index += 1;
        break;
      case "--chunk-size":
        if (!next) {
          throw new Error("--chunk-size requires a value");
        }
        parsed.chunkSize = Number.parseInt(next, 10);
        index += 1;
        break;
      case "--overlap":
        if (!next) {
          throw new Error("--overlap requires a value");
        }
        parsed.overlap = Number.parseInt(next, 10);
        index += 1;
        break;
      case "--help":
      case "-h":
        console.log(
          [
            "Usage: node --import tsx scripts/build-personal-knowledge-index.ts [options]",
            "",
            "Options:",
            "  --domain <domain>       Knowledge domain, default brand",
            "  --raw-dir <path>        Raw local books directory",
            "  --output <path>         Output index JSON path",
            "  --chunk-size <chars>    Chunk size, default 1200",
            "  --overlap <chars>       Chunk overlap, default 160",
          ].join("\n"),
        );
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${current}`);
    }
  }
  if (!Number.isFinite(parsed.chunkSize) || parsed.chunkSize <= 0) {
    throw new Error("--chunk-size must be a positive integer");
  }
  if (!Number.isFinite(parsed.overlap) || parsed.overlap < 0) {
    throw new Error("--overlap must be a non-negative integer");
  }
  return parsed;
}

async function commandExists(command: string): Promise<boolean> {
  return await new Promise((resolve) => {
    const child = spawn("bash", ["-lc", `command -v ${command}`], {
      stdio: "ignore",
    });
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

async function runPdfToText(filePath: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn("pdftotext", ["-layout", "-enc", "UTF-8", filePath, "-"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    const errorChunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => errorChunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            Buffer.concat(errorChunks).toString("utf8").trim() ||
              `pdftotext exited with code ${code}`,
          ),
        );
        return;
      }
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
}

async function runPandocPlainText(filePath: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn("pandoc", [filePath, "-t", "plain"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    const errorChunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => errorChunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            Buffer.concat(errorChunks).toString("utf8").trim() ||
              `pandoc exited with code ${code}`,
          ),
        );
        return;
      }
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
}

async function runZipText(filePath: string, memberPattern: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn("bash", ["-lc", `unzip -p "$1" '${memberPattern}' 2>/dev/null`, "bash", filePath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    const errorChunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => errorChunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (code !== 0 && !text.trim()) {
        reject(
          new Error(
            Buffer.concat(errorChunks).toString("utf8").trim() ||
              `unzip exited with code ${code}`,
          ),
        );
        return;
      }
      resolve(text);
    });
  });
}

function stripXmlText(value: string): string {
  return value
    .replace(/<a:t[^>]*>/gu, " ")
    .replace(/<w:tab\/>/gu, " ")
    .replace(/<w:br\/>/gu, "\n")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&amp;/gu, "&")
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/\s+/gu, " ")
    .trim();
}

async function readSourceText(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".pdf") {
    if (!(await commandExists("pdftotext"))) {
      throw new Error("pdftotext is required to index PDF books");
    }
    return await runPdfToText(filePath);
  }
  if (ext === ".epub") {
    if (!(await commandExists("pandoc"))) {
      throw new Error("pandoc is required to index EPUB books");
    }
    return await runPandocPlainText(filePath);
  }
  if (ext === ".docx") {
    if (!(await commandExists("pandoc"))) {
      throw new Error("pandoc is required to index DOCX files");
    }
    return await runPandocPlainText(filePath);
  }
  if (ext === ".pptx") {
    if (!(await commandExists("unzip"))) {
      throw new Error("unzip is required to index PPTX files");
    }
    return stripXmlText(await runZipText(filePath, "ppt/slides/slide*.xml"));
  }
  if (ext === ".html" || ext === ".htm") {
    if (await commandExists("pandoc")) {
      return await runPandocPlainText(filePath);
    }
  }
  return await fs.readFile(filePath, "utf8");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const index = await buildPersonalKnowledgeIndex({
    rootDir: args.rootDir,
    rawDir: args.rawDir,
    domain: args.domain,
    readSourceText,
    chunkSize: args.chunkSize,
    overlap: args.overlap,
  });
  await writePersonalKnowledgeIndex(index, args.output);
  console.log(
    [
      `[personal-knowledge] wrote ${path.relative(args.rootDir, args.output)}`,
      `[personal-knowledge] sources=${index.sources.length} chunks=${index.chunks.length} skipped=${index.skippedFiles.length}`,
    ].join("\n"),
  );
  if (index.skippedFiles.length > 0) {
    for (const skipped of index.skippedFiles.slice(0, 10)) {
      console.warn(`[personal-knowledge] skipped ${skipped.fileName}: ${skipped.reason}`);
    }
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
