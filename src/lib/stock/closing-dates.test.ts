import { describe, expect, it } from "vitest";
import { buenosAiresToday, closingDateProblem, closingReminderText, CLOSING_DATE_MESSAGES, friendlyDay, longDay, shiftDate } from "./closing-dates";

describe("buenosAiresToday", () => {
  it.each([
    ["2026-10-31T02:59:59Z", "2026-10-30"], // 23:59:59 in Buenos Aires
    ["2026-10-31T03:00:00Z", "2026-10-31"], // midnight in Buenos Aires
    ["2026-10-31T00:30:00Z", "2026-10-30"], // already the 31st in UTC, still the 30th here
    ["2026-10-31T23:59:00Z", "2026-10-31"],
    ["2027-01-01T02:00:00Z", "2026-12-31"], // year boundary
    ["2028-03-01T02:00:00Z", "2028-02-29"], // leap day
  ])("%s is %s in Buenos Aires", (iso, expected) => {
    expect(buenosAiresToday(new Date(iso))).toBe(expected);
  });
});

describe("shiftDate", () => {
  it("goes back across months and years", () => {
    expect(shiftDate("2026-11-01", 1)).toBe("2026-10-31");
    expect(shiftDate("2026-01-01", 1)).toBe("2025-12-31");
    expect(shiftDate("2026-10-30", 0)).toBe("2026-10-30");
  });
});

describe("closingDateProblem", () => {
  const today = "2026-10-31";
  it("allows today and any past day that is not closed", () => {
    expect(closingDateProblem(today, today, [])).toBeNull();
    expect(closingDateProblem("2026-10-30", today, new Set(["2026-10-29"]))).toBeNull();
    expect(closingDateProblem("2025-01-15", today, [])).toBeNull();
  });
  it("refuses future days and days already closed", () => {
    expect(closingDateProblem("2026-11-01", today, [])).toBe(CLOSING_DATE_MESSAGES.future);
    expect(closingDateProblem("2026-10-30", today, ["2026-10-30"])).toBe(CLOSING_DATE_MESSAGES.closed);
    expect(closingDateProblem(today, today, new Set([today]))).toBe(CLOSING_DATE_MESSAGES.closed);
  });
});

describe("friendlyDay / longDay", () => {
  it("uses the weekday and day number within the last week, the month further back, the year if another one", () => {
    expect(friendlyDay("2026-10-29", "2026-10-31")).toBe("jueves 29");
    expect(friendlyDay("2026-10-31", "2026-10-31")).toBe("sábado 31");
    expect(friendlyDay("2026-10-25", "2026-10-31")).toBe("domingo 25");
    expect(friendlyDay("2026-10-24", "2026-10-31")).toBe("sábado 24 de octubre");
    expect(friendlyDay("2025-12-30", "2026-01-02")).toBe("martes 30");
    expect(friendlyDay("2025-11-30", "2026-01-02")).toBe("domingo 30 de noviembre de 2025");
  });
  it("longDay keeps the full date", () => {
    expect(longDay("2026-10-30")).toBe("viernes 30/10/2026");
  });
});

describe("closingReminderText", () => {
  it("is null once today is closed", () => {
    expect(closingReminderText("2026-10-31", "2026-10-31")).toBeNull();
  });
  it("names the last closed day while today is open", () => {
    expect(closingReminderText("2026-10-29", "2026-10-30")).toBe(
      "La última rendición de materia prima cerrada es del jueves 29. Todavía no se cerró la de hoy.",
    );
    expect(closingReminderText("2026-09-30", "2026-10-30")).toBe(
      "La última rendición de materia prima cerrada es del miércoles 30 de septiembre. Todavía no se cerró la de hoy.",
    );
  });
  it("says so when none was ever closed", () => {
    expect(closingReminderText(null, "2026-10-30")).toBe("Todavía no se cerró ninguna rendición de materia prima.");
  });
});
