import { describe, expect, it } from "vitest";
import { HttpError } from "./errors";
import { assertSameOrigin } from "./same-origin";

const req = (headers: Record<string, string>) =>
  new Request("http://localhost:3000/api/uploads", { method: "POST", headers });

function status(r: Request) {
  try {
    assertSameOrigin(r);
  } catch (e) {
    expect(e).toBeInstanceOf(HttpError);
    return (e as HttpError).status;
  }
  return 200;
}

describe("assertSameOrigin", () => {
  it("accepts matching Origin and Host", () => {
    expect(status(req({ origin: "http://localhost:3000", host: "localhost:3000" }))).toBe(200);
  });
  it("rejects a different host", () => {
    expect(status(req({ origin: "http://evil.example", host: "localhost:3000" }))).toBe(403);
  });
  it("rejects a missing Origin", () => {
    expect(status(req({ host: "localhost:3000" }))).toBe(403);
  });
  it("rejects a malformed or null Origin", () => {
    expect(status(req({ origin: "null", host: "localhost:3000" }))).toBe(403);
  });
  it("uses X-Forwarded-Host when present", () => {
    expect(status(req({ origin: "https://burger.example", host: "127.0.0.1:3000", "x-forwarded-host": "burger.example" }))).toBe(200);
    expect(status(req({ origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000", "x-forwarded-host": "burger.example" }))).toBe(403);
  });
  it("accepts the first X-Forwarded-Host of a list", () => {
    expect(status(req({ origin: "https://burger.example", host: "x", "x-forwarded-host": "burger.example, proxy.internal" }))).toBe(200);
  });
});
