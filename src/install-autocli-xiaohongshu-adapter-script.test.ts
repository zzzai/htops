import { describe, expect, it, vi } from "vitest";

import { installAutocliXiaohongshuAdapter } from "./install-autocli-xiaohongshu-adapter-script.js";

describe("installAutocliXiaohongshuAdapter", () => {
  it("copies the repo-managed adapter into ~/.autocli/adapters/xiaohongshu", async () => {
    const ensureDir = vi.fn().mockResolvedValue(undefined);
    const copy = vi.fn().mockResolvedValue(undefined);
    const logs: string[] = [];

    const result = await installAutocliXiaohongshuAdapter({
      projectRoot: "/root/htops",
      homeDir: "/root",
      ensureDir,
      copy,
      log: (line) => logs.push(line),
    });

    expect(ensureDir).toHaveBeenCalledWith("/root/.autocli/adapters/xiaohongshu");
    expect(copy).toHaveBeenCalledWith(
      "/root/htops/tools/autocli-adapters/xiaohongshu/read-note.yaml",
      "/root/.autocli/adapters/xiaohongshu/read-note.yaml",
    );
    expect(result).toEqual({
      sourcePath: "/root/htops/tools/autocli-adapters/xiaohongshu/read-note.yaml",
      targetPath: "/root/.autocli/adapters/xiaohongshu/read-note.yaml",
    });
    expect(logs).toContain(
      "Installed AutoCLI Xiaohongshu adapter: /root/.autocli/adapters/xiaohongshu/read-note.yaml",
    );
  });
});
