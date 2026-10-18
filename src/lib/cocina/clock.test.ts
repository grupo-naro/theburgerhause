import { describe, expect, it } from "vitest";
import { serverClockNow } from "./clock";
import { ageMinutes } from "./card-style";

describe("serverClockNow", () => {
  const server = Date.parse("2026-10-18T15:10:00Z");
  it("starts at the server time and advances with the monotonic clock only", () => {
    expect(serverClockNow(server, 1000, 1000)).toBe(server);
    expect(serverClockNow(server, 1000, 1000 + 5 * 60_000)).toBe(server + 5 * 60_000);
  });
  it("never goes backwards", () => {
    expect(serverClockNow(server, 5000, 4000)).toBe(server);
  });
  it("ages keep growing even when the device wall clock is hours behind the server", () => {
    const since = "2026-10-18T15:00:00Z";
    expect(ageMinutes(since, serverClockNow(server, 0, 0))).toBe(10);
    expect(ageMinutes(since, serverClockNow(server, 0, 6 * 60_000))).toBe(16);
  });
});
