import { describe, expect, it } from "vitest";
import { resolveAccessImportBindings } from "./access-import.js";
import { resolveHetangOpsConfig } from "./config.js";

function buildConfig() {
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
    stores: [
      { orgId: "1001", storeName: "荷塘悦色义乌店", rawAliases: ["义乌店"] },
      { orgId: "1002", storeName: "荷塘悦色园中园店", rawAliases: ["园中园店"] },
      { orgId: "1003", storeName: "荷塘悦色迎宾店", rawAliases: ["迎宾店"] },
      { orgId: "1004", storeName: "荷塘悦色华美店", rawAliases: ["华美店"] },
      { orgId: "1005", storeName: "荷塘悦色锦苑店", rawAliases: ["锦苑店"] },
    ],
  });
}

describe("resolveAccessImportBindings", () => {
  it("maps named stores and aliases to manager scopes", () => {
    const bindings = resolveAccessImportBindings({
      config: buildConfig(),
      channel: "wecom",
      entries: [
        {
          senderId: "lirenpei",
          employeeName: "李人培",
          role: "manager",
          stores: ["义乌店", "荷塘悦色园中园店"],
          notes: "安阳市区运营总",
        },
      ],
    });

    expect(bindings).toEqual([
      expect.objectContaining({
        channel: "wecom",
        senderId: "lirenpei",
        employeeName: "李人培",
        role: "manager",
        orgId: undefined,
        scopeOrgIds: ["1001", "1002"],
        notes: "安阳市区运营总",
        isActive: true,
      }),
    ]);
  });

  it("keeps an hq user unscoped for all-store access", () => {
    const bindings = resolveAccessImportBindings({
      config: buildConfig(),
      channel: "wecom",
      entries: [
        {
          senderId: "zhangzhen",
          employeeName: "张震",
          role: "hq",
        },
      ],
    });

    expect(bindings).toEqual([
      expect.objectContaining({
        senderId: "zhangzhen",
        role: "hq",
        scopeOrgIds: [],
      }),
    ]);
  });

  it("rejects a manager entry with an unknown store token", () => {
    expect(() =>
      resolveAccessImportBindings({
        config: buildConfig(),
        channel: "wecom",
        entries: [
          {
            senderId: "bad-manager",
            employeeName: "错误示例",
            role: "manager",
            stores: ["不存在的门店"],
          },
        ],
      }),
    ).toThrow("Unknown store token");
  });

  it("rejects a non-hq entry that does not declare any stores", () => {
    expect(() =>
      resolveAccessImportBindings({
        config: buildConfig(),
        channel: "wecom",
        entries: [
          {
            senderId: "manager-without-scope",
            employeeName: "店长甲",
            role: "manager",
          },
        ],
      }),
    ).toThrow("stores are required");
  });

  it("allows a staff entry without store scopes for ordinary QA-only access", () => {
    const bindings = resolveAccessImportBindings({
      config: buildConfig(),
      channel: "wecom",
      entries: [
        {
          senderId: "lixiaofei",
          employeeName: "李小飞",
          role: "staff",
          notes: "郑州区运营总，仅普通问答，无门店数据权限",
        },
      ],
    });

    expect(bindings).toEqual([
      expect.objectContaining({
        senderId: "lixiaofei",
        employeeName: "李小飞",
        role: "staff",
        orgId: undefined,
        scopeOrgIds: [],
        notes: "郑州区运营总，仅普通问答，无门店数据权限",
        isActive: true,
      }),
    ]);
  });
});
