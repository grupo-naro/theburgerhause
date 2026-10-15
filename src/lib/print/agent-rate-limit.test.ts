import { afterEach, describe, expect, it } from "vitest";
import { AUTH_FAILURES_LIMIT, recordAgentAuthFailure, resetAgentRateLimit } from "./agent-rate-limit";

afterEach(resetAgentRateLimit);

describe("agent auth failure limiter", () => {
  it("allows 30 failures per IP, then reports a retry delay", () => {
    expect(AUTH_FAILURES_LIMIT).toBe(30);
    for (let i = 0; i < 30; i++) expect(recordAgentAuthFailure("1.1.1.1").ok).toBe(true);
    const blocked = recordAgentAuthFailure("1.1.1.1");
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(10 * 60 * 1000);
  });

  it("is per IP", () => {
    for (let i = 0; i < 31; i++) recordAgentAuthFailure("1.1.1.1");
    expect(recordAgentAuthFailure("2.2.2.2").ok).toBe(true);
  });

  it("reset forgets everything", () => {
    for (let i = 0; i < 31; i++) recordAgentAuthFailure("1.1.1.1");
    resetAgentRateLimit();
    expect(recordAgentAuthFailure("1.1.1.1").ok).toBe(true);
  });
});
