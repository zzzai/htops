import { describe, expect, it, vi } from "vitest";
import {
  compileControlledDataExplorerQuery,
  executeControlledDataExplorer,
  listControlledDataExplorerSurfaces,
} from "./controlled-data-explorer.js";

describe("controlled data explorer", () => {
  it("exposes only whitelisted serving surfaces and hides sensitive fields", () => {
    expect(listControlledDataExplorerSurfaces()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          surface: "serving_store_day",
          fields: expect.arrayContaining([
            expect.objectContaining({ name: "org_id" }),
            expect.objectContaining({ name: "service_revenue" }),
          ]),
        }),
        expect.objectContaining({
          surface: "serving_customer_profile_asof",
          fields: expect.not.arrayContaining([expect.objectContaining({ name: "phone" })]),
        }),
        expect.objectContaining({
          surface: "serving_tech_current",
          fields: expect.arrayContaining([
            expect.objectContaining({ name: "tech_name" }),
            expect.objectContaining({ name: "state_kind" }),
          ]),
        }),
      ]),
    );
  });

  it("compiles a parameterized query against a whitelisted serving surface", () => {
    expect(
      compileControlledDataExplorerQuery({
        surface: "serving_store_day",
        select: ["org_id", "biz_date", "service_revenue"],
        filters: [
          { field: "org_id", op: "eq", value: "1001" },
          { field: "biz_date", op: "between", value: ["2026-04-01", "2026-04-03"] },
        ],
        orderBy: { field: "service_revenue", direction: "desc" },
        limit: 20,
      }),
    ).toEqual({
      surface: "serving_store_day",
      columns: ["org_id", "biz_date", "service_revenue"],
      sql:
        'SELECT "org_id", "biz_date", "service_revenue" FROM "serving_store_day" WHERE "org_id" = $1 AND "biz_date" BETWEEN $2 AND $3 ORDER BY "service_revenue" DESC LIMIT 20',
      params: ["1001", "2026-04-01", "2026-04-03"],
      limit: 20,
    });
  });

  it("rejects raw tables, unknown fields, sensitive fields, and invalid filter operators", () => {
    expect(() =>
      compileControlledDataExplorerQuery({
        surface: "fact_consume_bills",
        select: ["org_id"],
      }),
    ).toThrow(/not allowed/u);

    expect(() =>
      compileControlledDataExplorerQuery({
        surface: "serving_store_day",
        select: ["raw_json"],
      }),
    ).toThrow(/Unknown field/u);

    expect(() =>
      compileControlledDataExplorerQuery({
        surface: "serving_customer_profile_asof",
        select: ["phone"],
      }),
    ).toThrow(/Unknown field/u);

    expect(() =>
      compileControlledDataExplorerQuery({
        surface: "serving_tech_current",
        select: ["raw_json"],
      }),
    ).toThrow(/Unknown field/u);

    expect(() =>
      compileControlledDataExplorerQuery({
        surface: "serving_store_day",
        select: ["org_id"],
        filters: [{ field: "store_name", op: "contains" as never, value: "义乌" }],
      }),
    ).toThrow(/operator/u);
  });

  it("executes through the provided read-only executor and returns bounded rows", async () => {
    const executeQuery = vi.fn().mockResolvedValue([
      { org_id: "1001", biz_date: "2026-04-01", service_revenue: 1200 },
    ]);

    await expect(
      executeControlledDataExplorer({
        request: {
          surface: "serving_store_day",
          select: ["org_id", "biz_date", "service_revenue"],
          filters: [{ field: "org_id", op: "eq", value: "1001" }],
          limit: 1,
        },
        executeQuery,
      }),
    ).resolves.toEqual({
      scope: "controlled_data_explorer_v1",
      surface: "serving_store_day",
      columns: ["org_id", "biz_date", "service_revenue"],
      rowCount: 1,
      limit: 1,
      rows: [{ org_id: "1001", biz_date: "2026-04-01", service_revenue: 1200 }],
    });
    expect(executeQuery).toHaveBeenCalledWith({
      sql:
        'SELECT "org_id", "biz_date", "service_revenue" FROM "serving_store_day" WHERE "org_id" = $1 LIMIT 1',
      queryParams: ["1001"],
      cacheKey: expect.stringContaining("controlled_data_explorer_v1:"),
      ttlSeconds: 60,
    });
  });
});
