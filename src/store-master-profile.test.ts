import { describe, expect, it } from "vitest";

import { buildStoreMasterDerivedFeatures } from "./store-master-profile.js";

describe("buildStoreMasterDerivedFeatures", () => {
  it("derives lifecycle, service window and capacity priors from a store master profile", () => {
    const features = buildStoreMasterDerivedFeatures({
      profile: {
        orgId: "627149864218629",
        storeName: "荷塘悦色迎宾店",
        openingDate: "2018-07-18",
        areaM2: 2000,
        roomCountTotal: 33,
        serviceHoursJson: {
          windows: [
            {
              start: "11:30",
              end: "02:00",
              overnight: true,
            },
          ],
        },
        updatedAt: "2026-04-21T10:00:00.000Z",
      },
      asOfDate: "2026-04-21",
    });

    expect(features.storeAgeMonths).toBe(93);
    expect(features.lifecycleStage).toBe("veteran");
    expect(features.serviceWindowHours).toBeCloseTo(14.5, 5);
    expect(features.nightWindowHours).toBeCloseTo(4, 5);
    expect(features.lateNightCapable).toBe(true);
    expect(features.storeScaleBand).toBe("flagship");
    expect(features.capacityPrior).toBe("very_high");
  });
});
