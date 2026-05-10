import { describe, expect, test } from "vitest";

import {
  buildHolidayContextEntries,
  classifyChineseHolidayDate,
  parseManualHolidayOverrides,
} from "./store-calendar-context.js";

describe("classifyChineseHolidayDate", () => {
  test("classifies fixed public holidays and weekends", () => {
    expect(classifyChineseHolidayDate("2026-01-01")).toMatchObject({
      isPublicHoliday: true,
      holidayName: "元旦",
      dayType: "holiday",
    });
    expect(classifyChineseHolidayDate("2026-05-09")).toMatchObject({
      isWeekend: true,
      dayType: "weekend",
    });
    expect(classifyChineseHolidayDate("2026-05-11")).toMatchObject({
      isPublicHoliday: false,
      isWeekend: false,
      dayType: "workday",
    });
  });

  test("applies manual holiday and workday overrides", () => {
    const overrides = parseManualHolidayOverrides({
      holidayDates: "2026-05-04:青年节活动",
      workdayDates: "2026-05-09:调休工作日",
    });

    expect(classifyChineseHolidayDate("2026-05-04", overrides)).toMatchObject({
      isPublicHoliday: true,
      holidayName: "青年节活动",
      dayType: "holiday",
    });
    expect(classifyChineseHolidayDate("2026-05-09", overrides)).toMatchObject({
      isPublicHoliday: false,
      isWeekend: false,
      holidayName: "调休工作日",
      dayType: "adjusted_workday",
    });
  });
});

describe("buildHolidayContextEntries", () => {
  test("publishes holiday context entries for all stores", () => {
    const rows = buildHolidayContextEntries({
      stores: [
        { orgId: "store-1", storeName: "测试店1" },
        { orgId: "store-2", storeName: "测试店2" },
      ],
      snapshotDate: "2026-01-01",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(rows).toHaveLength(8);
    expect(rows.find((row) => row.orgId === "store-1" && row.metricKey === "is_public_holiday")).toMatchObject({
      valueNum: 1,
      sourceType: "chinese_calendar_rules",
      sourceLabel: "China Calendar Rules + Manual Overrides",
      truthLevel: "estimated",
      confidence: "medium",
    });
    expect(rows.find((row) => row.orgId === "store-1" && row.metricKey === "holiday_name")).toMatchObject({
      valueText: "元旦",
    });
    expect(rows.find((row) => row.orgId === "store-1" && row.metricKey === "calendar_day_type")).toMatchObject({
      valueText: "holiday",
    });
  });
});
