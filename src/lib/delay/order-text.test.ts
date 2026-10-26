import { describe, expect, it } from "vitest";
import { elapsedMinutes, orderNoticeText, remainingRange } from "./order-text";

const range = { low: 20, high: 30 };

describe("remainingRange", () => {
  it("is the full range when nothing has elapsed", () => {
    expect(remainingRange(range, 0)).toEqual(range);
  });
  it("subtracts the elapsed minutes", () => {
    expect(remainingRange(range, 12)).toEqual({ low: 8, high: 18 });
  });
  it("keeps the low end above 0", () => {
    expect(remainingRange(range, 25)).toEqual({ low: 1, high: 5 });
  });
  it("is null once the range is used up", () => {
    expect(remainingRange(range, 30)).toBeNull();
    expect(remainingRange(range, 45)).toBeNull();
  });
});

describe("elapsedMinutes", () => {
  const now = Date.parse("2026-10-26T20:00:00Z");
  it("floors whole minutes", () => {
    expect(elapsedMinutes("2026-10-26T19:47:30Z", now)).toBe(12);
  });
  it("is 0 for a missing, invalid or future date", () => {
    expect(elapsedMinutes(undefined, now)).toBe(0);
    expect(elapsedMinutes("nope", now)).toBe(0);
    expect(elapsedMinutes("2026-10-26T20:05:00Z", now)).toBe(0);
  });
});

describe("orderNoticeText", () => {
  it("says listo for takeaway and llega for delivery", () => {
    expect(orderNoticeText({ range, elapsedMinutes: 0, fulfillment: "takeaway", delayed: false })).toBe("Tu pedido estará listo en aprox. 20–30 min");
    expect(orderNoticeText({ range, elapsedMinutes: 0, fulfillment: "delivery", delayed: false })).toBe("Tu pedido llega en aprox. 20–30 min");
  });
  it("adds the delayed note", () => {
    expect(orderNoticeText({ range, elapsedMinutes: 10, fulfillment: "delivery", delayed: true })).toBe(
      "Tu pedido llega en aprox. 10–20 min (hay más demora de lo normal)",
    );
  });
  it("falls back to 'en unos minutos' instead of numbers", () => {
    expect(orderNoticeText({ range, elapsedMinutes: 40, fulfillment: "takeaway", delayed: false })).toBe("Tu pedido estará listo en unos minutos");
  });
});
