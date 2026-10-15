import { describe, expect, it } from "vitest";
import { createFakeClock } from "@/lib/events/fake-clock";
import { HEARTBEAT_MS, createHeartbeat } from "./heartbeat";

function setup(visible = true) {
  const clock = createFakeClock();
  const state = { visible, ticks: 0 };
  const hb = createHeartbeat({
    intervalMs: HEARTBEAT_MS,
    schedule: clock.schedule,
    cancel: clock.cancel,
    isVisible: () => state.visible,
    onTick: () => void state.ticks++,
  });
  return { clock, state, hb };
}

describe("createHeartbeat", () => {
  it("ticks every 30 s while visible", () => {
    const { clock, state, hb } = setup();
    hb.start();
    clock.advance(29_999);
    expect(state.ticks).toBe(0);
    clock.advance(1);
    expect(state.ticks).toBe(1);
    clock.advance(60_000);
    expect(state.ticks).toBe(3);
  });

  it("does not run while hidden and refreshes immediately when it becomes visible", () => {
    const { clock, state, hb } = setup();
    hb.start();
    state.visible = false;
    hb.visibilityChanged();
    expect(clock.pending()).toBe(0);
    clock.advance(120_000);
    expect(state.ticks).toBe(0);
    state.visible = true;
    hb.visibilityChanged();
    expect(state.ticks).toBe(1);
    clock.advance(30_000);
    expect(state.ticks).toBe(2);
  });

  it("starting hidden waits for visibility; repeated visible events do not stack timers", () => {
    const { clock, state, hb } = setup(false);
    hb.start();
    expect(clock.pending()).toBe(0);
    state.visible = true;
    hb.visibilityChanged();
    hb.visibilityChanged();
    expect(clock.pending()).toBe(1);
  });

  it("stop clears the timer and ignores later events", () => {
    const { clock, state, hb } = setup();
    hb.start();
    hb.stop();
    expect(clock.pending()).toBe(0);
    hb.visibilityChanged();
    clock.advance(90_000);
    expect(state.ticks).toBe(0);
  });
});
