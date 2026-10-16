import { describe, expect, it } from "vitest";
import { pagerKey, pagerValue, type PagerKey } from "./pager-keypad";

const press = (keys: PagerKey[], from = "") => keys.reduce((s, k) => pagerKey(s, k), from);

describe("pagerKey state machine", () => {
  it("digits append", () => {
    expect(press(["1", "2"])).toBe("12");
  });
  it("max 3 digits (extra presses are ignored)", () => {
    expect(press(["1", "2", "3", "4", "5"])).toBe("123");
  });
  it("no leading zero", () => {
    expect(press(["0"])).toBe("");
    expect(press(["0", "0", "7"])).toBe("7");
  });
  it("zero is fine after a digit", () => {
    expect(press(["1", "0"])).toBe("10");
    expect(press(["1", "0", "0"])).toBe("100");
  });
  it("backspace removes the last digit, clear empties", () => {
    expect(press(["1", "2", "3", "back"])).toBe("12");
    expect(press(["back"])).toBe("");
    expect(press(["1", "2", "clear"])).toBe("");
  });
  it("clamps to 999 (cannot exceed with 3 digits)", () => {
    expect(press(["9", "9", "9"])).toBe("999");
    expect(pagerValue("999")).toBe(999);
  });
  it("unknown keys change nothing", () => {
    expect(pagerKey("12", "x" as PagerKey)).toBe("12");
  });
});

describe("pagerValue", () => {
  it("empty is invalid (null)", () => expect(pagerValue("")).toBeNull());
  it("1..999 parse", () => {
    expect(pagerValue("1")).toBe(1);
    expect(pagerValue("07")).toBe(7);
    expect(pagerValue("123")).toBe(123);
  });
  it("0, junk and out of range are invalid", () => {
    expect(pagerValue("0")).toBeNull();
    expect(pagerValue("1000")).toBeNull();
    expect(pagerValue("a")).toBeNull();
  });
});
