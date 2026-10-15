import { describe, expect, it } from "vitest";
import { initialShellState, shellFailed, shellRetried } from "./shell-boundary-state";

describe("shell boundary state", () => {
  it("starts healthy, fails on error and recovers on retry", () => {
    expect(initialShellState.failed).toBe(false);
    expect(shellFailed().failed).toBe(true);
    expect(shellRetried()).toEqual(initialShellState);
  });
});
