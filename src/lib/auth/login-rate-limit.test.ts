import { beforeEach, describe, expect, it } from "vitest";
import { isLoginBlocked, recordLoginFailure, resetLoginRateLimit } from "./login-rate-limit";

beforeEach(resetLoginRateLimit);

describe("login rate limit (failed attempts only)", () => {
  it("checking never consumes budget", () => {
    for (let i = 0; i < 200; i++) expect(isLoginBlocked("1.1.1.1", "cora")).toBe(false);
  });

  it("blocks the pair after 5 failures: the 6th attempt is refused", () => {
    for (let i = 0; i < 5; i++) {
      expect(isLoginBlocked("1.1.1.1", "cora")).toBe(false);
      recordLoginFailure("1.1.1.1", "cora");
    }
    expect(isLoginBlocked("1.1.1.1", "cora")).toBe(true);
    expect(isLoginBlocked("1.1.1.1", " CORA ")).toBe(true);
    expect(isLoginBlocked("1.1.1.1", "otro")).toBe(false);
    expect(isLoginBlocked("2.2.2.2", "cora")).toBe(false);
  });

  it("nine PCs behind one IP can each log in at shift start (successes are free)", () => {
    for (let pc = 0; pc < 9; pc++) expect(isLoginBlocked("9.9.9.9", `user${pc}`)).toBe(false);
  });

  it("a typo or two per PC does not lock the shared IP", () => {
    for (let pc = 0; pc < 9; pc++) {
      recordLoginFailure("9.9.9.9", `user${pc}`);
      recordLoginFailure("9.9.9.9", `user${pc}`);
    }
    expect(isLoginBlocked("9.9.9.9", "user0")).toBe(false);
    expect(isLoginBlocked("9.9.9.9", "nuevo")).toBe(false);
  });

  it("a spraying IP (many usernames) is still blocked after 60 failures", () => {
    for (let i = 0; i < 60; i++) recordLoginFailure("6.6.6.6", `u${i}`);
    expect(isLoginBlocked("6.6.6.6", "anyone")).toBe(true);
  });
});
