import { describe, expect, it } from "vitest";
import { createBeeper } from "./sound";

function fakeWindow(opts: { state?: "running" | "suspended"; throwOnCreate?: boolean } = {}) {
  const calls = { start: 0, created: 0 };
  class FakeAudioContext {
    state: "running" | "suspended" = opts.state ?? "running";
    currentTime = 0;
    destination = {};
    constructor() {
      if (opts.throwOnCreate) throw new Error("blocked");
      calls.created++;
    }
    resume = async () => {
      this.state = "running";
    };
    createOscillator = () => ({
      type: "",
      frequency: { setValueAtTime() {} },
      connect() {},
      start: () => void calls.start++,
      stop() {},
    });
    createGain = () => ({ gain: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {} });
  }
  return { win: { AudioContext: FakeAudioContext } as unknown as Window, calls };
}

describe("createBeeper", () => {
  it("one beep is exactly one oscillator start, only after unlock", async () => {
    const { win, calls } = fakeWindow();
    const b = createBeeper(win);
    b.play("new");
    expect(calls.start).toBe(0);
    expect(await b.unlock()).toBe(true);
    b.play("new");
    expect(calls.start).toBe(1);
  });

  it("a suspended context is resumed by unlock()", async () => {
    const { win } = fakeWindow({ state: "suspended" });
    const b = createBeeper(win);
    expect(b.ready()).toBe(false);
    expect(await b.unlock()).toBe(true);
    expect(b.ready()).toBe(true);
  });

  it("never throws without AudioContext or when creation is blocked", async () => {
    const none = createBeeper({} as Window);
    expect(none.supported).toBe(false);
    expect(await none.unlock()).toBe(false);
    expect(() => none.play("new")).not.toThrow();
    const blocked = createBeeper(fakeWindow({ throwOnCreate: true }).win);
    expect(await blocked.unlock()).toBe(false);
    expect(() => blocked.play("reminder")).not.toThrow();
  });
});
