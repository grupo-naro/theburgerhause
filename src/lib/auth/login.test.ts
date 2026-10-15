import { describe, expect, it } from "vitest";
import { roleHome, safeNextPath } from "@/lib/auth/login";

describe("safeNextPath", () => {
  it.each([
    ["/caja", "/caja"],
    ["/despacho/12?x=1", "/despacho/12?x=1"],
    ["//evil.com", "/fb"],
    ["https://evil.com", "/fb"],
    ["/\\evil.com", "/fb"],
    ["/a\\b", "/fb"],
    ["/\\", "/fb"],
    ["", "/fb"],
    ["caja", "/fb"],
    ["/login", "/fb"],
    ["/login?next=/x", "/fb"],
    ["/login/x", "/fb"],
    ["/caja\n", "/fb"],
    ["/ca\tja", "/fb"],
    ["/ca\u0000ja", "/fb"],
  ])("%j -> %s", (raw, expected) => {
    expect(safeNextPath(raw, "/fb")).toBe(expected);
  });

  it("falls back for null and undefined", () => {
    expect(safeNextPath(null, "/fb")).toBe("/fb");
    expect(safeNextPath(undefined, "/fb")).toBe("/fb");
  });
});

describe("roleHome", () => {
  it("maps each role to its landing page", () => {
    expect(roleHome("admin")).toBe("/admin");
    expect(roleHome("cajera")).toBe("/caja");
    expect(roleHome("encargada_delivery")).toBe("/despacho");
  });
});
