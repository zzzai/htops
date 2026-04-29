import { describe, expect, it } from "vitest";
import { buildHetangAccessContext } from "./access-context.js";

describe("buildHetangAccessContext", () => {
  it("returns an allow decision with effective org scope for a single-store manager", () => {
    const context = buildHetangAccessContext({
      action: "report",
      binding: {
        channel: "wecom",
        senderId: "manager-1",
        employeeName: "店长甲",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1001"],
      },
      usage: {
        hourlyCount: 1,
        dailyCount: 4,
      },
    });

    expect(context.decision.status).toBe("allow");
    expect(context.decision.reason).toBe("manager-own-store");
    expect(context.scope.org_ids).toEqual(["1001"]);
    expect(context.scope.scope_kind).toBe("single");
    expect(context.scope.effective_org_id).toBe("1001");
    expect(context.quotas).toEqual({
      hourly_limit: 6,
      daily_limit: 30,
      hourly_used: 1,
      daily_used: 4,
    });
  });

  it("returns a deny decision for a multi-store manager without requested store", () => {
    const context = buildHetangAccessContext({
      action: "report",
      binding: {
        channel: "wecom",
        senderId: "manager-2",
        employeeName: "区域运营",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1001", "1002"],
      },
      usage: {
        hourlyCount: 0,
        dailyCount: 0,
      },
    });

    expect(context.decision.status).toBe("deny");
    expect(context.decision.reason).toBe("manager-multi-store-requires-org");
    expect(context.scope.org_ids).toEqual(["1001", "1002"]);
    expect(context.scope.scope_kind).toBe("multi");
    expect(context.scope.effective_org_id).toBeUndefined();
  });

  it("keeps reactivation commands available to managers without quota consumption", () => {
    const context = buildHetangAccessContext({
      action: "reactivation",
      binding: {
        channel: "wecom",
        senderId: "manager-1",
        employeeName: "店长甲",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1001"],
      },
      usage: {
        hourlyCount: 6,
        dailyCount: 30,
      },
    });

    expect(context.decision.status).toBe("allow");
    expect(context.decision.reason).toBe("manager-own-store");
    expect(context.decision.consume_quota).toBe(false);
    expect(context.scope.effective_org_id).toBe("1001");
  });
});
