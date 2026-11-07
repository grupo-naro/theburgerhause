import { describe, expect, it } from "vitest";
import { businessDayStart, pctChange, resolvePeriod } from "./period";

const CUT = "06:00";
const at = (iso: string) => new Date(iso);
const SAT_NIGHT = at("2026-11-07T22:00:00-03:00");

describe("resolvePeriod", () => {
  it("hoy compares with same weekday last week, cut at same time", () => {
    const p = resolvePeriod({ p: "hoy" }, SAT_NIGHT, CUT);
    expect(p).toMatchObject({ kind: "hoy", from: "2026-11-07", to: "2026-11-07", prevFrom: "2026-10-31", prevTo: "2026-10-31" });
    expect(p.prevCutAt?.toISOString()).toBe(at("2026-10-31T22:00:00-03:00").toISOString());
  });

  it("01:30 is still the previous business day", () => {
    const p = resolvePeriod({ p: "hoy" }, at("2026-11-08T01:30:00-03:00"), CUT);
    expect(p.from).toBe("2026-11-07");
    expect(p.prevCutAt?.toISOString()).toBe(at("2026-11-01T01:30:00-03:00").toISOString());
  });

  it("default is semana Monday→today vs same days last week", () => {
    expect(resolvePeriod({}, SAT_NIGHT, CUT)).toMatchObject({
      kind: "semana",
      from: "2026-11-02",
      to: "2026-11-07",
      prevFrom: "2026-10-26",
      prevTo: "2026-10-31",
    });
  });

  it("semana on a Monday is a single day", () => {
    expect(resolvePeriod({ p: "semana" }, at("2026-11-02T21:00:00-03:00"), CUT)).toMatchObject({
      from: "2026-11-02",
      to: "2026-11-02",
      prevFrom: "2026-10-26",
      prevTo: "2026-10-26",
    });
  });

  it("semana on a Sunday starts the previous Monday", () => {
    expect(resolvePeriod({ p: "semana" }, at("2026-11-08T21:00:00-03:00"), CUT)).toMatchObject({
      from: "2026-11-02",
      to: "2026-11-08",
    });
  });

  it("mes clamps to the previous month's last day", () => {
    expect(resolvePeriod({ p: "mes" }, at("2026-03-31T21:00:00-03:00"), CUT)).toMatchObject({
      kind: "mes",
      from: "2026-03-01",
      to: "2026-03-31",
      prevFrom: "2026-02-01",
      prevTo: "2026-02-28",
    });
  });

  it("mes in January compares with December of the previous year", () => {
    expect(resolvePeriod({ p: "mes" }, at("2027-01-10T21:00:00-03:00"), CUT)).toMatchObject({
      from: "2027-01-01",
      to: "2027-01-10",
      prevFrom: "2026-12-01",
      prevTo: "2026-12-10",
    });
  });

  it("custom in the past has the same-length previous range and no cut", () => {
    expect(resolvePeriod({ p: "custom", desde: "2026-10-10", hasta: "2026-10-19" }, SAT_NIGHT, CUT)).toMatchObject({
      kind: "custom",
      from: "2026-10-10",
      to: "2026-10-19",
      prevFrom: "2026-09-30",
      prevTo: "2026-10-09",
      prevCutAt: null,
    });
  });

  it("custom ending today gets the same-time cut", () => {
    const p = resolvePeriod({ p: "custom", desde: "2026-11-06", hasta: "2026-11-07" }, SAT_NIGHT, CUT);
    expect(p).toMatchObject({ prevFrom: "2026-11-04", prevTo: "2026-11-05" });
    expect(p.prevCutAt?.toISOString()).toBe(at("2026-11-05T22:00:00-03:00").toISOString());
  });

  it.each([
    [{ p: "custom", desde: "2026-13-40", hasta: "2026-10-19" }],
    [{ p: "custom", desde: "2026-02-30", hasta: "2026-03-02" }],
    [{ p: "custom", desde: "2026-10-19", hasta: "2026-10-10" }],
    [{ p: "custom", desde: "2025-01-01", hasta: "2026-10-10" }],
    [{ p: "custom" }],
    [{ p: "xx" }],
  ])("invalid custom falls back to semana %#", (q) => {
    expect(resolvePeriod(q, SAT_NIGHT, CUT).kind).toBe("semana");
  });
});

describe("businessDayStart", () => {
  it("is the date at the cutoff in Buenos Aires", () => {
    expect(businessDayStart("2026-11-07", "06:00").toISOString()).toBe(at("2026-11-07T06:00:00-03:00").toISOString());
  });
});

describe("pctChange", () => {
  it("rounds and returns null without a base", () => {
    expect(pctChange(112, 100)).toBe(12);
    expect(pctChange(0, 0)).toBeNull();
    expect(pctChange(5, 0)).toBeNull();
    expect(pctChange(0, 50)).toBe(-100);
  });
});
