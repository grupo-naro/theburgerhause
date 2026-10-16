import { describe, expect, it } from "vitest";
import { URGENCY_THRESHOLDS_MIN, minutesSince, orderUrgency, type UrgencyLane } from "./urgency";

const since = "2026-10-15T15:00:00.000Z";
const at = (min: number, extraMs = 0) => Date.parse(since) + min * 60_000 + extraMs;

describe("URGENCY_THRESHOLDS_MIN", () => {
  it("is the agreed table (minutes in the current status)", () => {
    expect(URGENCY_THRESHOLDS_MIN).toEqual({
      preparing: { warning: 10, urgent: 15 },
      ready: { warning: 5, urgent: 10 },
      pickup: { warning: 5, urgent: 10 },
      enRoute: { warning: 30, urgent: 45 },
    });
  });
});

describe("orderUrgency boundaries", () => {
  const cases: [UrgencyLane, number, number][] = [
    ["preparing", 10, 15],
    ["ready", 5, 10],
    ["pickup", 5, 10],
    ["enRoute", 30, 45],
  ];
  it.each(cases)("%s: normal below %i, warning from %i, urgent from %i", (lane, warn, urgent) => {
    expect(orderUrgency(lane, since, at(warn, -1))).toBe("normal");
    expect(orderUrgency(lane, since, at(warn))).toBe("warning");
    expect(orderUrgency(lane, since, at(urgent, -1))).toBe("warning");
    expect(orderUrgency(lane, since, at(urgent))).toBe("urgent");
    expect(orderUrgency(lane, since, at(urgent + 120))).toBe("urgent");
  });
  it("is normal for a future or unparsable start", () => {
    expect(orderUrgency("ready", since, at(-5))).toBe("normal");
    expect(orderUrgency("ready", "garbage", at(100))).toBe("normal");
  });
});

describe("minutesSince", () => {
  it("floors whole minutes and never goes negative", () => {
    expect(minutesSince(since, at(6, 59_000))).toBe(6);
    expect(minutesSince(since, at(-3))).toBe(0);
    expect(minutesSince("garbage", at(3))).toBe(0);
  });
});
