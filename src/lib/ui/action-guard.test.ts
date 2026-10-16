import { describe, expect, it } from "vitest";
import { createActionGuard } from "./action-guard";

describe("createActionGuard", () => {
  it("lets only the first of two synchronous starts through", () => {
    const g = createActionGuard();
    expect(g.tryStart()).toBe(true);
    expect(g.tryStart()).toBe(false);
  });
  it("finish(false) reopens the guard (a failed or settled action can be retried)", () => {
    const g = createActionGuard();
    g.tryStart();
    g.finish(false);
    expect(g.tryStart()).toBe(true);
  });
  it("finish(true) (lockOnSuccess) keeps it closed until release()", () => {
    const g = createActionGuard();
    g.tryStart();
    g.finish(true);
    expect(g.tryStart()).toBe(false);
    g.release();
    expect(g.tryStart()).toBe(true);
  });
  it("release() on an idle guard is harmless", () => {
    const g = createActionGuard();
    g.release();
    expect(g.tryStart()).toBe(true);
  });
});
