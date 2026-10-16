import { describe, expect, it } from "vitest";
import { shortcutFor, type KeyInfo } from "./shortcuts";

const k = (over: Partial<KeyInfo>): KeyInfo => ({ key: "", ctrlKey: false, metaKey: false, altKey: false, typing: false, ...over });

describe("shortcutFor", () => {
  it("/ focuses the search when not typing", () => {
    expect(shortcutFor(k({ key: "/" }))).toBe("search");
  });
  it("/ is a normal character while typing in a field", () => {
    expect(shortcutFor(k({ key: "/", typing: true }))).toBeNull();
  });
  it("Ctrl+Enter / Cmd+Enter charge, even while typing", () => {
    expect(shortcutFor(k({ key: "Enter", ctrlKey: true }))).toBe("charge");
    expect(shortcutFor(k({ key: "Enter", metaKey: true, typing: true }))).toBe("charge");
  });
  it("plain Enter is not a shortcut", () => {
    expect(shortcutFor(k({ key: "Enter" }))).toBeNull();
  });
  it("Alt+L clears the ticket (not while typing)", () => {
    expect(shortcutFor(k({ key: "l", altKey: true }))).toBe("clear");
    expect(shortcutFor(k({ key: "L", altKey: true }))).toBe("clear");
    expect(shortcutFor(k({ key: "l", altKey: true, typing: true }))).toBeNull();
  });
  it("a modified / is left to the browser", () => {
    expect(shortcutFor(k({ key: "/", ctrlKey: true }))).toBeNull();
    expect(shortcutFor(k({ key: "/", altKey: true }))).toBeNull();
  });
  it("auto-repeat is ignored", () => {
    expect(shortcutFor(k({ key: "Enter", ctrlKey: true, repeat: true }))).toBeNull();
  });
  it("other keys are nothing", () => {
    expect(shortcutFor(k({ key: "a" }))).toBeNull();
    expect(shortcutFor(k({ key: "Escape" }))).toBeNull();
  });
});
