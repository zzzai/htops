import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveHetangOpsConfig } from "./config.js";

const tempDirs: string[] = [];

function buildConfig(storeSpecs: Array<{ orgId: string; storeName: string; rawAliases?: string[] }>) {
  return resolveHetangOpsConfig({
    api: {
      appKey: "demo-app-key",
      appSecret: "demo-app-secret",
    },
    database: {
      url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
    },
    sync: {
      enabled: false,
    },
    reporting: {
      enabled: false,
    },
    stores: storeSpecs,
  });
}

async function createRootDir(prefix: string) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(rootDir);
  await fs.mkdir(path.join(rootDir, "access"), { recursive: true });
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

describe("resolveAutoProvisionEmployeeBinding", () => {
  it("falls back to the public example roster when the local roster file is absent", async () => {
    const rootDir = await createRootDir("htops-access-roster-example-");
    await fs.writeFile(
      path.join(rootDir, "access", "wecom-access-roster.v1.example.json"),
      JSON.stringify({
        entries: [],
        plannedEntries: [
          {
            employeeName: "示例区域运营",
            matchNames: ["示例区域运营", "示例区域运营-城市区运营"],
            role: "manager",
            stores: ["示例一店", "示例二店"],
            notes: "public example",
          },
        ],
      }),
      "utf8",
    );

    vi.stubEnv("HTOPS_ROOT_DIR", rootDir);

    const { resolveAutoProvisionEmployeeBinding } = await import("./access-roster.js");
    const binding = resolveAutoProvisionEmployeeBinding({
      config: buildConfig([
        { orgId: "store-a", storeName: "示例一店", rawAliases: ["示例一店"] },
        { orgId: "store-b", storeName: "示例二店", rawAliases: ["示例二店"] },
      ]),
      channel: "wecom",
      senderId: "example-manager",
      senderName: "示例区域运营-城市区运营",
    });

    expect(binding).toEqual(
      expect.objectContaining({
        channel: "wecom",
        senderId: "example-manager",
        employeeName: "示例区域运营",
        role: "manager",
        orgId: undefined,
        scopeOrgIds: ["store-a", "store-b"],
        isActive: true,
      }),
    );
  });

  it("auto provisions the configured live manager scopes by sender name", async () => {
    const { resolveAutoProvisionEmployeeBinding } = await import("./access-roster.js");
    const config = buildConfig([
      { orgId: "1001", storeName: "荷塘悦色义乌店", rawAliases: ["义乌店"] },
      { orgId: "1002", storeName: "荷塘悦色园中园店", rawAliases: ["园中园店"] },
      { orgId: "1003", storeName: "荷塘悦色迎宾店", rawAliases: ["迎宾店"] },
      { orgId: "1004", storeName: "荷塘悦色华美店", rawAliases: ["华美店"] },
      { orgId: "1005", storeName: "荷塘悦色锦苑店", rawAliases: ["锦苑店"] },
    ]);

    expect(
      resolveAutoProvisionEmployeeBinding({
        config,
        channel: "wecom",
        senderId: "guozc-live",
        senderName: "郭正朝-迎宾店-店长-A3",
      }),
    ).toEqual(
      expect.objectContaining({
        employeeName: "郭正朝",
        role: "manager",
        orgId: "1003",
        scopeOrgIds: ["1003"],
      }),
    );

    expect(
      resolveAutoProvisionEmployeeBinding({
        config,
        channel: "wecom",
        senderId: "hcj-live",
        senderName: "侯朝君-林州区运营总",
      }),
    ).toEqual(
      expect.objectContaining({
        employeeName: "侯朝君",
        role: "manager",
        orgId: "1002",
        scopeOrgIds: ["1002"],
      }),
    );

    expect(
      resolveAutoProvisionEmployeeBinding({
        config,
        channel: "wecom",
        senderId: "lirp-live",
        senderName: "李人培-安阳市区运营总",
      }),
    ).toEqual(
      expect.objectContaining({
        employeeName: "李人培",
        role: "manager",
        orgId: undefined,
        scopeOrgIds: ["1003", "1001"],
      }),
    );

    expect(
      resolveAutoProvisionEmployeeBinding({
        config,
        channel: "wecom",
        senderId: "liuliang-live",
        senderName: "刘亮-滑县区运营总",
      }),
    ).toEqual(
      expect.objectContaining({
        employeeName: "刘亮",
        role: "manager",
        orgId: undefined,
        scopeOrgIds: ["1005", "1004"],
      }),
    );
  });

  it("prefers the local roster file over the public example", async () => {
    const rootDir = await createRootDir("htops-access-roster-local-");
    await fs.writeFile(
      path.join(rootDir, "access", "wecom-access-roster.v1.example.json"),
      JSON.stringify({
        entries: [
          {
            employeeName: "示例总部同学",
            matchNames: ["示例总部同学"],
            role: "hq",
          },
        ],
      }),
      "utf8",
    );
    await fs.writeFile(
      path.join(rootDir, "access", "wecom-access-roster.v1.json"),
      JSON.stringify({
        entries: [
          {
            employeeName: "本地真实运营",
            matchNames: ["本地真实运营", "本地真实运营-区域总"],
            role: "manager",
            stores: ["本地门店"],
          },
        ],
      }),
      "utf8",
    );

    vi.stubEnv("HTOPS_ROOT_DIR", rootDir);

    const { resolveAutoProvisionEmployeeBinding } = await import("./access-roster.js");
    const binding = resolveAutoProvisionEmployeeBinding({
      config: buildConfig([{ orgId: "local-store", storeName: "本地门店", rawAliases: ["本地门店"] }]),
      channel: "wecom",
      senderId: "local-manager",
      senderName: "本地真实运营-区域总",
    });

    expect(binding).toEqual(
      expect.objectContaining({
        employeeName: "本地真实运营",
        role: "manager",
        orgId: "local-store",
        scopeOrgIds: ["local-store"],
      }),
    );
  });
});
