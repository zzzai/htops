import path from "node:path";
import os from "node:os";
import { copyFile, mkdir } from "node:fs/promises";

export async function installAutocliXiaohongshuAdapter(params: {
  projectRoot?: string;
  homeDir?: string;
  ensureDir?: (dirPath: string) => Promise<void>;
  copy?: (sourcePath: string, targetPath: string) => Promise<void>;
  log?: (line: string) => void;
} = {}): Promise<{
  sourcePath: string;
  targetPath: string;
}> {
  const projectRoot = params.projectRoot ?? process.cwd();
  const homeDir = params.homeDir ?? os.homedir();
  const sourcePath = path.join(
    projectRoot,
    "tools",
    "autocli-adapters",
    "xiaohongshu",
    "read-note.yaml",
  );
  const targetDir = path.join(homeDir, ".autocli", "adapters", "xiaohongshu");
  const targetPath = path.join(targetDir, "read-note.yaml");
  const ensureDir =
    params.ensureDir ??
    (async (dirPath: string) => {
      await mkdir(dirPath, { recursive: true });
    });
  const copy = params.copy ?? copyFile;

  await ensureDir(targetDir);
  await copy(sourcePath, targetPath);

  params.log?.(`Installed AutoCLI Xiaohongshu adapter: ${targetPath}`);
  params.log?.("Next: ensure autocli is installed, load the Chrome extension, then run `autocli doctor`.");

  return {
    sourcePath,
    targetPath,
  };
}
