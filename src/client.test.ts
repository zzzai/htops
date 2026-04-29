import { describe, expect, it } from "vitest";
import { HetangApiClient } from "./client.js";

describe("HetangApiClient", () => {
  it("fails with a clear error when API credentials are missing", async () => {
    const client = new HetangApiClient({
      baseUrl: "http://example.test/api/thirdparty",
      pageSize: 200,
      timeoutMs: 5_000,
      maxRetries: 1,
    });

    await expect(
      client.fetchPaged("1.1", {
        OrgId: "1001",
        Stime: "2026-03-27 00:00:00",
        Etime: "2026-03-30 03:10:00",
      }),
    ).rejects.toThrow("Hetang API credentials are not configured");
  });

  it("posts JSON request bodies for live Hetang APIs", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new HetangApiClient(
      {
        appKey: "demo-app-key",
        appSecret: "demo-app-secret",
        baseUrl: "http://example.test/api/thirdparty",
        pageSize: 200,
        timeoutMs: 5_000,
        maxRetries: 1,
      },
      async (input, init) => {
        calls.push({ url: String(input), init });
        return new Response(
          JSON.stringify({
            Code: 200,
            Msg: "操作成功",
            RetData: {
              Total: 1,
              Data: [{ Id: "M-001" }],
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      },
    );

    const rows = await client.fetchPaged("1.1", {
      OrgId: "1001",
      Stime: "2026-03-27 00:00:00",
      Etime: "2026-03-30 03:10:00",
    });

    expect(rows).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("http://example.test/api/thirdparty/GetCustomersList");
    expect(calls[0]?.init?.headers).toMatchObject({
      "content-type": "application/json;charset=UTF-8",
    });
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({
      OrgId: "1001",
      Stime: "2026-03-27 00:00:00",
      Etime: "2026-03-30 03:10:00",
      PageIndex: 1,
      PageSize: 200,
    });
  });
});
