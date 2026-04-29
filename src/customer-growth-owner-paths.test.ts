import { describe, expect, it } from "vitest";

import { buildEnvironmentContextSnapshot } from "./customer-growth/environment-context.js";
import { resolveBirthdayMonthDay } from "./customer-growth/birthday-utils.js";
import { qualifiesHighValueMemberWindow } from "./customer-growth/semantics.js";
import { extractConsumeCustomerRefs } from "./customer-growth/intelligence.js";
import { lookupStructuredCustomerProfile } from "./customer-growth/profile.js";
import { lookupStructuredMemberRecallCandidates } from "./customer-growth/query.js";
import { buildMemberReactivationFeaturesForBizDate } from "./customer-growth/reactivation/features.js";
import { buildMemberReactivationStrategiesForBizDate } from "./customer-growth/reactivation/strategy.js";
import { buildMemberReactivationQueueForBizDate } from "./customer-growth/reactivation/queue.js";
import { renderReactivationPushMessage } from "./customer-growth/reactivation/push.js";
import { HetangReactivationExecutionService } from "./customer-growth/reactivation/execution-service.js";

describe("customer growth owner paths", () => {
  it("exposes migrated environment and helper modules from the owner directory", () => {
    const snapshot = buildEnvironmentContextSnapshot({
      bizDate: "2026-04-19",
      weather: {
        condition: "clear",
        temperatureC: 22,
      },
    });
    expect(snapshot.solarTerm).toBeDefined();
    expect(resolveBirthdayMonthDay(JSON.stringify({ Birthday: "1990-05-02" }))).toBe("05-02");
    expect(
      qualifiesHighValueMemberWindow({
        visitCount90d: 4,
        payAmount90d: 1200,
        memberPayAmount90d: 800,
      }),
    ).toBe(true);
  });

  it("exposes migrated customer growth pipeline modules from the owner directory", () => {
    expect(typeof extractConsumeCustomerRefs).toBe("function");
    expect(typeof lookupStructuredCustomerProfile).toBe("function");
    expect(typeof lookupStructuredMemberRecallCandidates).toBe("function");
    expect(typeof buildMemberReactivationFeaturesForBizDate).toBe("function");
    expect(typeof buildMemberReactivationStrategiesForBizDate).toBe("function");
    expect(typeof buildMemberReactivationQueueForBizDate).toBe("function");
    expect(typeof renderReactivationPushMessage).toBe("function");
    expect(HetangReactivationExecutionService).toBeTypeOf("function");
  });
});
