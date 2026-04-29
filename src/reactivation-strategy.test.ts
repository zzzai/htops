import { DataType, newDb as createBaseDb } from "pg-mem";
import { describe, expect, it } from "vitest";

import {
  buildMemberReactivationStrategiesForBizDate,
  rebuildMemberReactivationStrategiesForDateRange,
} from "./reactivation-strategy.js";
import { HetangOpsStore } from "./store.js";
import type { EnvironmentContextSnapshot, MemberReactivationFeatureRecord } from "./types.js";

function newDb() {
  const db = createBaseDb();
  const heldLocks = new Set<number>();
  db.public.registerFunction({
    name: "pg_advisory_lock",
    args: [DataType.bigint],
    returns: DataType.bool,
    implementation: (lockKey: number | bigint) => {
      heldLocks.add(Number(lockKey));
      return true;
    },
  });
  db.public.registerFunction({
    name: "pg_try_advisory_lock",
    args: [DataType.bigint],
    returns: DataType.bool,
    implementation: (lockKey: number | bigint) => {
      const normalized = Number(lockKey);
      if (heldLocks.has(normalized)) {
        return false;
      }
      heldLocks.add(normalized);
      return true;
    },
  });
  db.public.registerFunction({
    name: "pg_advisory_unlock",
    args: [DataType.bigint],
    returns: DataType.bool,
    implementation: (lockKey: number | bigint) => heldLocks.delete(Number(lockKey)),
  });
  db.public.registerFunction({
    name: "right",
    args: [DataType.text, DataType.integer],
    returns: DataType.text,
    implementation: (value: string, count: number) =>
      typeof value === "string" ? value.slice(-Math.max(0, Number(count))) : "",
  });
  return db;
}

function buildFeatureRow(
  overrides: Partial<MemberReactivationFeatureRecord> = {},
): MemberReactivationFeatureRecord {
  return {
    orgId: "627149864218629",
    bizDate: "2026-04-09",
    memberId: "M-001",
    customerIdentityKey: "member:M-001",
    customerDisplayName: "王女士",
    memberCardNo: "YB001",
    referenceCode: "YB001",
    primarySegment: "important-reactivation-member",
    daysSinceLastVisit: 18,
    visitCount30d: 1,
    visitCount90d: 4,
    payAmount30d: 240,
    payAmount90d: 1200,
    memberPayAmount30d: 240,
    memberPayAmount90d: 1200,
    rechargeTotal30d: 0,
    rechargeTotal90d: 300,
    rechargeCount30d: 0,
    rechargeCount90d: 1,
    daysSinceLastRecharge: 60,
    currentStoredBalanceInferred: 320,
    storedBalance7dAgo: 420,
    storedBalance30dAgo: 760,
    storedBalance90dAgo: 1180,
    storedBalanceDelta7d: -100,
    storedBalanceDelta30d: -440,
    storedBalanceDelta90d: -860,
    depletionVelocity30d: 14.6667,
    projectedBalanceDaysLeft: 21.8,
    rechargeToMemberPayRatio90d: 0.25,
    dominantVisitDaypart: "after-work",
    preferredDaypartShare90d: 0.75,
    dominantVisitWeekday: "thursday",
    preferredWeekdayShare90d: 0.5,
    dominantVisitMonthPhase: "early",
    preferredMonthPhaseShare90d: 0.5,
    weekendVisitShare90d: 0.25,
    lateNightVisitShare90d: 0,
    overnightVisitShare90d: 0,
    averageVisitGapDays90d: 9,
    visitGapStddevDays90d: 1.8,
    cycleDeviationScore: 1.0,
    timePreferenceConfidenceScore: 0.68,
    trajectoryConfidenceScore: 0.92,
    reactivationPriorityScore: 742.5,
    featureJson: "{}",
    ...overrides,
  };
}

describe("reactivation-strategy", () => {
  it("derives churn risk, revisit window, touch window, and strategy priority from feature rows", () => {
    const rows = buildMemberReactivationStrategiesForBizDate({
      orgId: "627149864218629",
      bizDate: "2026-04-09",
      featureRows: [
        buildFeatureRow(),
        buildFeatureRow({
          memberId: "M-002",
          customerIdentityKey: "member:M-002",
          customerDisplayName: "李先生",
          memberCardNo: "YB002",
          referenceCode: "YB002",
          primarySegment: "potential-growth-customer",
          daysSinceLastVisit: 5,
          visitCount30d: 2,
          visitCount90d: 2,
          payAmount30d: 520,
          payAmount90d: 620,
          memberPayAmount30d: 280,
          memberPayAmount90d: 280,
          rechargeTotal90d: 0,
          rechargeCount90d: 0,
          daysSinceLastRecharge: null,
          currentStoredBalanceInferred: 60,
          storedBalance7dAgo: 60,
          storedBalance30dAgo: 80,
          storedBalance90dAgo: 80,
          storedBalanceDelta7d: 0,
          storedBalanceDelta30d: -20,
          storedBalanceDelta90d: -20,
          depletionVelocity30d: 0.6667,
          projectedBalanceDaysLeft: 90,
          rechargeToMemberPayRatio90d: 0,
          dominantVisitDaypart: "afternoon",
          preferredDaypartShare90d: 1,
          dominantVisitWeekday: "monday",
          preferredWeekdayShare90d: 0.5,
          dominantVisitMonthPhase: "early",
          preferredMonthPhaseShare90d: 1,
          averageVisitGapDays90d: 14,
          visitGapStddevDays90d: 0,
          cycleDeviationScore: 0,
          timePreferenceConfidenceScore: 0.85,
          trajectoryConfidenceScore: 0.6,
          reactivationPriorityScore: 520.4,
        }),
      ],
    });

    const urgent = rows.find((row) => row.memberId === "M-001");
    const growth = rows.find((row) => row.memberId === "M-002");

    expect(urgent).toEqual(
      expect.objectContaining({
        memberId: "M-001",
        churnRiskLabel: "high",
        revisitWindowLabel: "due-now",
        touchWindowLabel: "best-today",
        lifecycleMomentumLabel: "cooling",
        recommendedActionLabel: "immediate-1to1",
      }),
    );
    expect(urgent?.strategyPriorityScore).toBeGreaterThan(urgent?.reactivationPriorityScore ?? 0);
    expect(growth).toEqual(
      expect.objectContaining({
        memberId: "M-002",
        churnRiskLabel: "medium",
        revisitWindowLabel: "not-due",
        lifecycleMomentumLabel: "accelerating",
        recommendedActionLabel: "growth-nurture",
      }),
    );
    expect(urgent?.strategyPriorityScore).toBeGreaterThan(growth?.strategyPriorityScore ?? 0);
  });

  it("persists strategy rows by day through the store", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: [{ orgId: "627149864218629", storeName: "荷塘悦色迎宾店", rawAliases: [] }],
    });
    await store.initialize();

    const rows = buildMemberReactivationStrategiesForBizDate({
      orgId: "627149864218629",
      bizDate: "2026-04-09",
      featureRows: [buildFeatureRow()],
    });

    await store.replaceMemberReactivationStrategies(
      "627149864218629",
      "2026-04-09",
      rows,
      "2026-04-09T15:00:00.000Z",
      { refreshViews: false },
    );

    const stored = await store.listMemberReactivationStrategies("627149864218629", "2026-04-09");
    expect(stored).toHaveLength(1);
    expect(stored[0]).toEqual(
      expect.objectContaining({
        memberId: "M-001",
        churnRiskLabel: "high",
        recommendedActionLabel: "immediate-1to1",
      }),
    );

    await store.close();
    await pool.end();
  });

  it("applies an evening-outing boost for late-night capable contexts", () => {
    const base = buildMemberReactivationStrategiesForBizDate({
      orgId: "627149864218629",
      bizDate: "2026-04-09",
      featureRows: [
        buildFeatureRow({
          dominantVisitDaypart: "late-night",
          dominantVisitWeekday: "thursday",
          preferredDaypartShare90d: 0.82,
        }),
      ],
    })[0];

    const environmentContext = {
      bizDate: "2026-04-09",
      seasonTag: "spring",
      isWeekend: false,
      holidayTag: "workday",
      postDinnerLeisureBias: "high",
      eveningOutingLikelihood: "high",
      badWeatherTouchPenalty: "none",
    } satisfies EnvironmentContextSnapshot;

    const boosted = buildMemberReactivationStrategiesForBizDate({
      orgId: "627149864218629",
      bizDate: "2026-04-09",
      featureRows: [
        buildFeatureRow({
          dominantVisitDaypart: "late-night",
          dominantVisitWeekday: "thursday",
          preferredDaypartShare90d: 0.82,
        }),
      ],
      environmentContext,
    })[0];

    expect(boosted?.recommendedTouchDaypart).toBe("late-night");
    expect((boosted?.touchWindowMatchScore ?? 0)).toBeGreaterThan(base?.touchWindowMatchScore ?? 0);
    expect((boosted?.strategyPriorityScore ?? 0)).toBeGreaterThan(base?.strategyPriorityScore ?? 0);
    expect(boosted?.strategyJson).toContain("\"environmentContext\"");
  });

  it("applies bounded learning calibration from recent reactivation outcomes without changing the action label", () => {
    const base = buildMemberReactivationStrategiesForBizDate({
      orgId: "627149864218629",
      bizDate: "2026-04-18",
      featureRows: [
        buildFeatureRow({
          bizDate: "2026-04-18",
        }),
      ],
    })[0];

    const calibrated = buildMemberReactivationStrategiesForBizDate({
      orgId: "627149864218629",
      bizDate: "2026-04-18",
      featureRows: [
        buildFeatureRow({
          bizDate: "2026-04-18",
        }),
      ],
      outcomeSnapshotRows: [
        {
          orgId: "627149864218629",
          bizDate: "2026-04-10",
          memberId: "M-H1",
          customerIdentityKey: "member:M-H1",
          customerDisplayName: "A",
          primarySegment: "important-reactivation-member",
          followupBucket: "high-value-reactivation",
          priorityBand: "P0",
          recommendedActionLabel: "immediate-1to1",
          feedbackStatus: "arrived",
          contacted: true,
          replied: true,
          booked: true,
          arrived: true,
          closed: false,
          outcomeLabel: "arrived",
          outcomeScore: 1,
          learningJson: "{}",
          updatedAt: "2026-04-10T10:00:00.000Z",
        },
        {
          orgId: "627149864218629",
          bizDate: "2026-04-11",
          memberId: "M-H2",
          customerIdentityKey: "member:M-H2",
          customerDisplayName: "B",
          primarySegment: "important-reactivation-member",
          followupBucket: "high-value-reactivation",
          priorityBand: "P0",
          recommendedActionLabel: "immediate-1to1",
          feedbackStatus: "booked",
          contacted: true,
          replied: true,
          booked: true,
          arrived: false,
          closed: false,
          outcomeLabel: "booked",
          outcomeScore: 0.82,
          learningJson: "{}",
          updatedAt: "2026-04-11T10:00:00.000Z",
        },
        {
          orgId: "627149864218629",
          bizDate: "2026-04-12",
          memberId: "M-H3",
          customerIdentityKey: "member:M-H3",
          customerDisplayName: "C",
          primarySegment: "important-reactivation-member",
          followupBucket: "high-value-reactivation",
          priorityBand: "P0",
          recommendedActionLabel: "immediate-1to1",
          feedbackStatus: "booked",
          contacted: true,
          replied: true,
          booked: true,
          arrived: false,
          closed: false,
          outcomeLabel: "booked",
          outcomeScore: 0.82,
          learningJson: "{}",
          updatedAt: "2026-04-12T10:00:00.000Z",
        },
        {
          orgId: "627149864218629",
          bizDate: "2026-04-13",
          memberId: "M-H4",
          customerIdentityKey: "member:M-H4",
          customerDisplayName: "D",
          primarySegment: "important-reactivation-member",
          followupBucket: "high-value-reactivation",
          priorityBand: "P0",
          recommendedActionLabel: "immediate-1to1",
          feedbackStatus: "booked",
          contacted: true,
          replied: true,
          booked: true,
          arrived: false,
          closed: false,
          outcomeLabel: "booked",
          outcomeScore: 0.82,
          learningJson: "{}",
          updatedAt: "2026-04-13T10:00:00.000Z",
        },
      ],
    })[0];

    expect(calibrated?.recommendedActionLabel).toBe(base?.recommendedActionLabel);
    expect((calibrated?.strategyPriorityScore ?? 0)).toBeGreaterThan(base?.strategyPriorityScore ?? 0);
    expect(calibrated?.strategyJson).toContain("\"learningCalibration\"");
    expect(calibrated?.strategyJson).toContain("\"sampleCount\":4");
  });

  it("applies a bad-weather penalty to same-day touch confidence", () => {
    const base = buildMemberReactivationStrategiesForBizDate({
      orgId: "627149864218629",
      bizDate: "2026-04-09",
      featureRows: [buildFeatureRow()],
    })[0];

    const environmentContext = {
      bizDate: "2026-04-09",
      seasonTag: "spring",
      isWeekend: false,
      holidayTag: "workday",
      weatherTag: "rain",
      temperatureBand: "cool",
      precipitationTag: "heavy",
      windTag: "high",
      badWeatherTouchPenalty: "high",
    } satisfies EnvironmentContextSnapshot;

    const penalized = buildMemberReactivationStrategiesForBizDate({
      orgId: "627149864218629",
      bizDate: "2026-04-09",
      featureRows: [buildFeatureRow()],
      environmentContext,
    })[0];

    expect((penalized?.touchWindowMatchScore ?? 0)).toBeLessThan(base?.touchWindowMatchScore ?? 0);
    expect((penalized?.strategyPriorityScore ?? 0)).toBeLessThan(base?.strategyPriorityScore ?? 0);
    expect(penalized?.touchWindowLabel).not.toBe("best-today");
  });

  it("keeps solar term in strategy metadata when environment context is present", () => {
    const environmentContext = {
      bizDate: "2026-04-20",
      seasonTag: "spring",
      monthTag: "04",
      solarTerm: "guyu",
      isWeekend: false,
      holidayTag: "workday",
      postDinnerLeisureBias: "medium",
      eveningOutingLikelihood: "medium",
      badWeatherTouchPenalty: "none",
    } as const satisfies EnvironmentContextSnapshot;

    const row = buildMemberReactivationStrategiesForBizDate({
      orgId: "627149864218629",
      bizDate: "2026-04-20",
      featureRows: [
        buildFeatureRow({
          bizDate: "2026-04-20",
          dominantVisitWeekday: "monday",
          dominantVisitDaypart: "late-night",
        }),
      ],
      environmentContext,
    })[0];

    expect(row?.strategyJson).toContain("\"solarTerm\":\"guyu\"");
  });

  it("rebuilds strategy rows with inferred environment context from store facts", async () => {
    const replacedRows: Array<{ strategyJson: string }> = [];

    const fakeStore = {
      listMemberReactivationFeaturesByDateRange: async () => [
        buildFeatureRow({
          bizDate: "2026-04-18",
          dominantVisitWeekday: "saturday",
          dominantVisitDaypart: "late-night",
          preferredDaypartShare90d: 0.82,
        }),
      ],
      listMemberReactivationOutcomeSnapshotsByDateRange: async () => [],
      replaceMemberReactivationStrategies: async (
        _orgId: string,
        _bizDate: string,
        rows: Array<{ strategyJson: string }>,
      ) => {
        replacedRows.push(...rows);
      },
    } satisfies Partial<HetangOpsStore>;

    await rebuildMemberReactivationStrategiesForDateRange({
      store: fakeStore as unknown as HetangOpsStore,
      orgId: "627149864218629",
      startBizDate: "2026-04-18",
      endBizDate: "2026-04-18",
      storeConfig: {
        orgId: "627149864218629",
        storeName: "荷塘悦色迎宾店",
        roomCount: 24,
        operatingHoursPerDay: 15,
      },
    });

    expect(replacedRows[0]?.strategyJson).toContain("\"environmentContext\"");
    expect(replacedRows[0]?.strategyJson).toContain("\"eveningOutingLikelihood\":\"high\"");
  });

  it("chunks long strategy rebuilds so daily refresh can be rerun safely", async () => {
    const featureCalls: Array<{ startBizDate: string; endBizDate: string }> = [];
    const replacedBizDates: string[] = [];

    const fakeStore = {
      listMemberReactivationFeaturesByDateRange: async (
        _orgId: string,
        startBizDate: string,
        endBizDate: string,
      ) => {
        featureCalls.push({ startBizDate, endBizDate });
        return [
          buildFeatureRow({
            bizDate: endBizDate,
          }),
        ];
      },
      listMemberReactivationOutcomeSnapshotsByDateRange: async () => [],
      replaceMemberReactivationStrategies: async (_orgId: string, bizDate: string) => {
        replacedBizDates.push(bizDate);
      },
    } satisfies Partial<HetangOpsStore>;

    const rebuiltDays = await rebuildMemberReactivationStrategiesForDateRange({
      store: fakeStore as unknown as HetangOpsStore,
      orgId: "627149864218629",
      startBizDate: "2026-04-01",
      endBizDate: "2026-04-15",
    });

    expect(rebuiltDays).toBe(15);
    expect(featureCalls).toEqual([
      { startBizDate: "2026-04-01", endBizDate: "2026-04-07" },
      { startBizDate: "2026-04-08", endBizDate: "2026-04-14" },
      { startBizDate: "2026-04-15", endBizDate: "2026-04-15" },
    ]);
    expect(replacedBizDates).toHaveLength(15);
  });
  it("applies bounded operating profile adjustments without mutating the base segment", () => {
    const feature = buildFeatureRow({
      dominantVisitDaypart: null,
      preferredDaypartShare90d: null,
      timePreferenceConfidenceScore: 0.22,
      primarySegment: "important-reactivation-member",
    });

    const base = buildMemberReactivationStrategiesForBizDate({
      orgId: "627149864218629",
      bizDate: "2026-04-09",
      featureRows: [feature],
    })[0];

    const adjusted = buildMemberReactivationStrategiesForBizDate({
      orgId: "627149864218629",
      bizDate: "2026-04-09",
      featureRows: [feature],
      operatingProfileRows: [
        {
          orgId: "627149864218629",
          bizDate: "2026-04-09",
          memberId: "M-001",
          customerIdentityKey: "member:M-001",
          customerDisplayName: "王女士",
          identityProfileJson: {},
          spendingProfileJson: {},
          serviceNeedProfileJson: {
            primary_need: "肩颈放松",
            confidence_discount: 0.1,
          },
          interactionProfileJson: {
            communication_style: "少聊天",
            confidence_discount: 0.2,
          },
          preferenceProfileJson: {
            preferred_daypart: "夜场",
            preferred_channel: "企微",
            preferred_channel_confidence_discount: 0.15,
            preferred_tech_name: "安老师",
          },
          scenarioProfileJson: {},
          relationshipProfileJson: {
            top_tech_name: "安老师",
          },
          opportunityProfileJson: {},
          sourceSignalIds: ["sig-1"],
          updatedAt: "2026-04-09T12:00:00.000Z",
        },
      ],
    })[0];

    expect(base?.primarySegment).toBe("important-reactivation-member");
    expect(adjusted?.primarySegment).toBe("important-reactivation-member");
    expect(base?.recommendedTouchDaypart).toBeNull();
    expect(adjusted?.recommendedTouchDaypart).toBe("late-night");
    expect((adjusted?.touchWindowMatchScore ?? 0)).toBeGreaterThan(base?.touchWindowMatchScore ?? 0);
    expect((adjusted?.strategyPriorityScore ?? 0)).toBeGreaterThan(base?.strategyPriorityScore ?? 0);
    expect(adjusted?.strategyJson).toContain("\"operatingProfileBridge\"");
    expect(adjusted?.strategyJson).toContain("肩颈放松");
  });

});
