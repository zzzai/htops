import { describe, expect, it } from "vitest";
import { authorizeHetangCommand, resolveQuotaLimits } from "./access.js";

describe("authorizeHetangCommand", () => {
  it("allows an unscoped hq binding to access any requested store", () => {
    const result = authorizeHetangCommand({
      action: "report",
      binding: {
        channel: "wecom",
        senderId: "hq-1",
        employeeName: "总部甲",
        role: "hq",
        isActive: true,
        scopeOrgIds: [],
      },
      usage: {
        hourlyCount: 0,
        dailyCount: 0,
      },
      requestedOrgId: "1002",
    });

    expect(result).toMatchObject({
      allowed: true,
      effectiveOrgId: "1002",
      reason: "hq-allowed",
    });
  });

  it("defaults a single-scope manager to the only allowed store", () => {
    const result = authorizeHetangCommand({
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

    expect(result).toMatchObject({
      allowed: true,
      effectiveOrgId: "1001",
      reason: "manager-own-store",
    });
  });

  it("requires a multi-scope manager to specify one allowed store", () => {
    const result = authorizeHetangCommand({
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

    expect(result).toMatchObject({
      allowed: false,
      reason: "manager-multi-store-requires-org",
    });
  });

  it("lets a multi-scope manager query a permitted store", () => {
    const result = authorizeHetangCommand({
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
      requestedOrgId: "1002",
    });

    expect(result).toMatchObject({
      allowed: true,
      effectiveOrgId: "1002",
      reason: "manager-own-store",
    });
  });

  it("lets a manager access action and learning commands for the bound store without consuming quota", () => {
    const actionResult = authorizeHetangCommand({
      action: "action",
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
      requestedOrgId: "1001",
    });
    const learningResult = authorizeHetangCommand({
      action: "learning",
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
      requestedOrgId: "1001",
    });

    expect(actionResult).toMatchObject({
      allowed: true,
      effectiveOrgId: "1001",
      reason: "manager-own-store",
      consumeQuota: false,
    });
    expect(learningResult).toMatchObject({
      allowed: true,
      effectiveOrgId: "1001",
      reason: "manager-own-store",
      consumeQuota: false,
    });
  });

  it("lets a manager access reactivation commands for the bound store without consuming quota", () => {
    const result = authorizeHetangCommand({
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
      requestedOrgId: "1001",
    });

    expect(result).toMatchObject({
      allowed: true,
      effectiveOrgId: "1001",
      reason: "manager-own-store",
      consumeQuota: false,
    });
  });

  it("keeps tower commands hq-only", () => {
    const denied = authorizeHetangCommand({
      action: "tower",
      binding: {
        channel: "wecom",
        senderId: "manager-1",
        employeeName: "店长甲",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1001"],
      },
      usage: {
        hourlyCount: 0,
        dailyCount: 0,
      },
    });
    const allowed = authorizeHetangCommand({
      action: "tower",
      binding: {
        channel: "wecom",
        senderId: "hq-1",
        employeeName: "总部甲",
        role: "hq",
        isActive: true,
        scopeOrgIds: [],
      },
      usage: {
        hourlyCount: 0,
        dailyCount: 0,
      },
    });

    expect(denied).toMatchObject({
      allowed: false,
      reason: "hq-only",
      consumeQuota: false,
    });
    expect(allowed).toMatchObject({
      allowed: true,
      reason: "hq-allowed",
      consumeQuota: false,
    });
  });

  it("lets control tower quota overrides replace role defaults", () => {
    const limits = resolveQuotaLimits(
      {
        channel: "wecom",
        senderId: "manager-1",
        employeeName: "店长甲",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["1001"],
      },
      {
        hourlyLimit: 12,
        dailyLimit: 60,
      },
    );

    expect(limits).toEqual({
      hourlyLimit: 12,
      dailyLimit: 60,
    });
  });

  it("keeps the legacy authorize result shape after access-context refactoring", () => {
    const result = authorizeHetangCommand({
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

    expect(result).toEqual({
      allowed: true,
      action: "report",
      reason: "manager-own-store",
      effectiveOrgId: "1001",
      hourlyLimit: 6,
      dailyLimit: 30,
      consumeQuota: true,
    });
  });
});
