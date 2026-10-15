import { describe, expect, it } from "vitest";
import { clientIp } from "@/lib/client-ip";

const h = (v?: string) => new Headers(v === undefined ? {} : { "x-forwarded-for": v });

describe("clientIp", () => {
  it.each([
    ["1.2.3.4", "1.2.3.4"],
    ["6.6.6.6, 1.2.3.4", "1.2.3.4"],
    ["6.6.6.6,7.7.7.7,  1.2.3.4  ", "1.2.3.4"],
    ["2001:db8::1", "2001:db8::1"],
    ["9.9.9.9, 2001:db8::1", "2001:db8::1"],
    ["", "unknown"],
    ["   ", "unknown"],
    ["1.2.3.4,", "unknown"],
  ])("%j -> %s", (raw, expected) => {
    expect(clientIp(h(raw))).toBe(expected);
  });
  it("is unknown when the header is absent", () => {
    expect(clientIp(h())).toBe("unknown");
  });
});
