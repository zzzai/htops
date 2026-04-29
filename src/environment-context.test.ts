import { describe, expect, it } from "vitest";

import { buildEnvironmentContextSnapshot } from "./environment-context.js";

describe("environment-context", () => {
  it("derives season and weekend tags from biz date", () => {
    const snapshot = buildEnvironmentContextSnapshot({
      bizDate: "2026-04-18",
    });

    expect(snapshot).toMatchObject({
      bizDate: "2026-04-18",
      seasonTag: "spring",
      monthTag: "04",
      isWeekend: true,
      holidayTag: "weekend",
    });
  });

  it("derives a deterministic solar term from biz date", () => {
    expect(
      buildEnvironmentContextSnapshot({
        bizDate: "2026-04-05",
      }).solarTerm,
    ).toBe("qingming");

    expect(
      buildEnvironmentContextSnapshot({
        bizDate: "2026-04-20",
      }).solarTerm,
    ).toBe("guyu");

    expect(
      buildEnvironmentContextSnapshot({
        bizDate: "2026-12-22",
      }).solarTerm,
    ).toBe("dongzhi");
  });

  it("classifies weather into bounded environment tags", () => {
    const snapshot = buildEnvironmentContextSnapshot({
      bizDate: "2026-04-14",
      weather: {
        condition: "小雨",
        temperatureC: 11,
        precipitationMm: 16,
        windLevel: 6,
      },
    });

    expect(snapshot).toMatchObject({
      weatherTag: "rain",
      temperatureBand: "cool",
      precipitationTag: "heavy",
      windTag: "high",
      badWeatherTouchPenalty: "high",
    });
  });

  it("combines city and store context into evening-outing hints", () => {
    const snapshot = buildEnvironmentContextSnapshot({
      bizDate: "2026-04-17",
      cityContext: {
        citySeasonalPattern: "north-city-spring-v1",
        nightlifeSeasonality: "spring-evening-active",
        northCityEveningLeisureBias: true,
      },
      storeContext: {
        lateNightCapable: true,
        storeNightSceneBias: "high",
        postDinnerLeisureBias: "high",
      },
      weather: {
        condition: "晴",
        temperatureC: 22,
        precipitationMm: 0,
        windLevel: 2,
      },
    });

    expect(snapshot).toMatchObject({
      seasonTag: "spring",
      postDinnerLeisureBias: "high",
      eveningOutingLikelihood: "high",
      badWeatherTouchPenalty: "none",
    });
  });

  it("applies bounded solar-term nudges without overriding weather precedence", () => {
    const springComfort = buildEnvironmentContextSnapshot({
      bizDate: "2026-04-20",
    });
    const deepWinter = buildEnvironmentContextSnapshot({
      bizDate: "2026-01-20",
    });
    const stormySpring = buildEnvironmentContextSnapshot({
      bizDate: "2026-04-20",
      weather: {
        condition: "暴雨",
        temperatureC: 12,
        precipitationMm: 20,
        windLevel: 7,
      },
    });

    expect(springComfort.solarTerm).toBe("guyu");
    expect(springComfort.postDinnerLeisureBias).toBe("medium");
    expect(springComfort.eveningOutingLikelihood).toBe("medium");

    expect(deepWinter.solarTerm).toBe("dahan");
    expect(deepWinter.postDinnerLeisureBias).toBe("low");
    expect(deepWinter.eveningOutingLikelihood).toBe("low");

    expect(stormySpring.badWeatherTouchPenalty).toBe("high");
    expect(stormySpring.eveningOutingLikelihood).toBe("low");
  });

  it("derives memory-oriented weekday and disturbance fields", () => {
    const snapshot = buildEnvironmentContextSnapshot({
      bizDate: "2026-04-26",
      calendarContext: {
        holidayTag: "adjusted_workday",
        holidayName: "劳动节调休上班",
        isAdjustedWorkday: true,
      },
      weather: {
        condition: "暴雨",
        temperatureC: 13,
        precipitationMm: 28,
        windLevel: 7,
      },
    });

    expect(snapshot).toMatchObject({
      bizDate: "2026-04-26",
      isWeekend: true,
      holidayTag: "adjusted_workday",
      holidayName: "劳动节调休上班",
      isAdjustedWorkday: true,
      weekdayLabel: "周日",
      environmentDisturbanceLevel: "high",
      narrativePolicy: "mention",
    });
  });
});
