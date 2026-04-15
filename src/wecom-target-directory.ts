import fs from "node:fs";
import path from "node:path";

import { resolveStandaloneRootDir } from "./standalone-env.js";

type WeComTargetDirectoryEntry = {
  target?: string;
  aliases?: string[];
  notes?: string;
};

type WeComTargetDirectoryFile = {
  entries?: WeComTargetDirectoryEntry[];
};

function loadJsonFile<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function loadBuiltInWeComTargetDirectory(): WeComTargetDirectoryFile {
  const rootDir = resolveStandaloneRootDir();
  const candidates = [
    path.join(rootDir, "ops", "wecom-target-directory.v1.json"),
    path.join(rootDir, "ops", "wecom-target-directory.v1.example.json"),
  ];

  for (const candidate of candidates) {
    const loaded = loadJsonFile<WeComTargetDirectoryFile>(candidate);
    if (loaded) {
      return loaded;
    }
  }

  return {};
}

const rawDirectory = loadBuiltInWeComTargetDirectory();
const builtInDirectory = Array.isArray(rawDirectory.entries) ? rawDirectory.entries : [];

function normalizeWeComTargetAlias(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[()（）【】[\]{}《》「」『』]/gu, "")
    .replace(/[\s\-—_·•,，.。;；:：/\\|]/gu, "");
  return normalized.length > 0 ? normalized : null;
}

export function resolveWeComTargetAlias(target: string): string {
  const trimmed = target.trim();
  if (!trimmed) {
    return target;
  }

  const normalizedTarget = normalizeWeComTargetAlias(trimmed);
  if (!normalizedTarget) {
    return trimmed;
  }

  for (const entry of builtInDirectory) {
    const aliases = Array.isArray(entry.aliases) ? entry.aliases : [];
    const matches = aliases
      .map((alias) => normalizeWeComTargetAlias(alias))
      .filter((alias): alias is string => Boolean(alias));
    if (matches.includes(normalizedTarget) && typeof entry.target === "string" && entry.target.trim()) {
      return entry.target.trim();
    }
  }

  return trimmed;
}
