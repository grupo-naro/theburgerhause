import { beforeEach, describe, expect, it } from "vitest";
import { isPinBlocked, PIN_FAILURE_LIMIT, recordPinFailure, resetPinRateLimit } from "./pin-rate-limit";

beforeEach(resetPinRateLimit);

describe("pin rate limit", () => {
  it("blocks a user after 5 failures, per user", () => {
    expect(PIN_FAILURE_LIMIT).toBe(5);
    for (let i = 0; i < 4; i++) recordPinFailure(1);
    expect(isPinBlocked(1).blocked).toBe(false);
    recordPinFailure(1);
    const b = isPinBlocked(1);
    expect(b.blocked).toBe(true);
    expect(b.retryAfterMs).toBeGreaterThan(0);
    expect(isPinBlocked(2).blocked).toBe(false);
  });
});
