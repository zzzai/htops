import { describe, expect, it } from "vitest";
import { parseLegacyYingbinImportArgs } from "./legacy-mysql-import-cli.js";

describe("parseLegacyYingbinImportArgs", () => {
  it("parses explicit mysql, date range, and dry-run options", () => {
    expect(
      parseLegacyYingbinImportArgs([
        "--mysql-host",
        "127.0.0.1",
        "--mysql-port",
        "13307",
        "--mysql-user",
        "root",
        "--mysql-password",
        "demo",
        "--org-id",
        "627149864218629",
        "--start",
        "2025-01-01",
        "--end",
        "2025-01-31",
        "--dry-run",
      ]),
    ).toEqual({
      mysqlHost: "127.0.0.1",
      mysqlPort: 13307,
      mysqlUser: "root",
      mysqlPassword: "demo",
      orgId: "627149864218629",
      startBizDate: "2025-01-01",
      endBizDate: "2025-01-31",
      legacyOrgId: 214001,
      dryRun: true,
      rebuildMissingSnapshots: true,
    });
  });

  it("applies stable defaults for the local restored container", () => {
    expect(
      parseLegacyYingbinImportArgs([
        "--mysql-user",
        "root",
      ]),
    ).toEqual({
      mysqlHost: "127.0.0.1",
      mysqlPort: 13307,
      mysqlUser: "root",
      mysqlPassword: undefined,
      orgId: "627149864218629",
      startBizDate: undefined,
      endBizDate: undefined,
      legacyOrgId: 214001,
      dryRun: false,
      rebuildMissingSnapshots: true,
    });
  });
});
