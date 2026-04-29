import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const tempDirs: string[] = [];

async function createRootDir(prefix: string) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(rootDir);
  await fs.mkdir(path.join(rootDir, "ops"), { recursive: true });
  return rootDir;
}

afterEach(async () => {
  vi.resetModules();
  vi.unstubAllEnvs();
  delete process.env.HTOPS_ROOT_DIR;
  delete process.env.HETANG_ROOT_DIR;

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) {
      continue;
    }
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe("resolveWeComTargetAlias", () => {
  it("falls back to the public example target directory when the local file is absent", async () => {
    const rootDir = await createRootDir("htops-wecom-target-example-");
    await fs.writeFile(
      path.join(rootDir, "ops", "wecom-target-directory.v1.example.json"),
      JSON.stringify({
        entries: [
          {
            target: "EXAMPLE_CHAT_ID",
            aliases: ["示例群", "shared-delivery"],
          },
        ],
      }),
      "utf8",
    );

    vi.stubEnv("HTOPS_ROOT_DIR", rootDir);

    const { resolveWeComTargetAlias } = await import("./wecom-target-directory.js");

    expect(resolveWeComTargetAlias("示例群")).toBe("EXAMPLE_CHAT_ID");
  });

  it("prefers the local target directory over the public example", async () => {
    const rootDir = await createRootDir("htops-wecom-target-local-");
    await fs.writeFile(
      path.join(rootDir, "ops", "wecom-target-directory.v1.example.json"),
      JSON.stringify({
        entries: [
          {
            target: "EXAMPLE_CHAT_ID",
            aliases: ["示例群"],
          },
        ],
      }),
      "utf8",
    );
    await fs.writeFile(
      path.join(rootDir, "ops", "wecom-target-directory.v1.json"),
      JSON.stringify({
        entries: [
          {
            target: "LOCAL_CHAT_ID",
            aliases: ["本地群"],
          },
        ],
      }),
      "utf8",
    );

    vi.stubEnv("HTOPS_ROOT_DIR", rootDir);

    const { resolveWeComTargetAlias } = await import("./wecom-target-directory.js");

    expect(resolveWeComTargetAlias("本地群")).toBe("LOCAL_CHAT_ID");
  });
});
