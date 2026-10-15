import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateStationToken, hashStationToken, isWellFormedStationToken } from "./token";

describe("generateStationToken", () => {
  it("has the bhst_ prefix and 32 random bytes as base64url (48 chars)", () => {
    const t = generateStationToken();
    expect(t).toMatch(/^bhst_[A-Za-z0-9_-]{43}$/);
    expect(t).toHaveLength(48);
  });
  it("is unique across 100 generations", () => {
    expect(new Set(Array.from({ length: 100 }, generateStationToken)).size).toBe(100);
  });
});

describe("hashStationToken", () => {
  it("is a stable sha256 hex (64 chars) of the token", () => {
    const t = generateStationToken();
    const h = hashStationToken(t);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashStationToken(t)).toBe(h);
    expect(h).toBe(createHash("sha256").update(t).digest("hex"));
    expect(h).not.toContain(t);
  });
  it("differs for different tokens", () => {
    expect(hashStationToken(generateStationToken())).not.toBe(hashStationToken(generateStationToken()));
  });
});

describe("isWellFormedStationToken", () => {
  it("accepts generated tokens", () => {
    expect(isWellFormedStationToken(generateStationToken())).toBe(true);
  });
  it("rejects anything else", () => {
    const good = generateStationToken();
    for (const bad of [
      "",
      "bhst_",
      good.slice(1),
      good.replace("bhst_", "xxxx_"),
      `${good}x`,
      `${good} `,
      good.slice(0, -1) + "+",
      good.slice(0, -1) + "=",
      "a".repeat(48),
    ]) {
      expect(isWellFormedStationToken(bad)).toBe(false);
    }
    for (const nonString of [null, undefined, 5, {}, ["x"]]) {
      expect(isWellFormedStationToken(nonString as unknown as string)).toBe(false);
    }
  });
});
