import { describe, expect, it } from "vitest";
import { navLinksForRole } from "./nav";

const links = (r: Parameters<typeof navLinksForRole>[0]) => navLinksForRole(r).map((l) => [l.href, l.label]);

describe("navLinksForRole", () => {
  it("cajera: Caja, Mostrador", () => {
    expect(links("cajera")).toEqual([
      ["/caja", "Caja"],
      ["/mostrador", "Mostrador"],
    ]);
  });
  it("encargada de delivery: Despacho, Caja", () => {
    expect(links("encargada_delivery")).toEqual([
      ["/despacho", "Despacho"],
      ["/caja", "Caja"],
    ]);
  });
  it("admin: every screen plus Administración", () => {
    expect(links("admin")).toEqual([
      ["/caja", "Caja"],
      ["/mostrador", "Mostrador"],
      ["/despacho", "Despacho"],
      ["/admin", "Administración"],
    ]);
  });
});
