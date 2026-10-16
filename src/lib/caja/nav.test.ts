import { describe, expect, it } from "vitest";
import { activeNavHref, navLinksForRole } from "./nav";

const links = (r: Parameters<typeof navLinksForRole>[0]) => navLinksForRole(r).map((l) => [l.href, l.label]);

describe("navLinksForRole", () => {
  it("cajera: Caja, Mostrador, Despacho (no Rendición)", () => {
    expect(links("cajera")).toEqual([
      ["/caja", "Caja"],
      ["/mostrador", "Mostrador"],
      ["/despacho", "Despacho"],
    ]);
  });
  it("encargada de delivery: Despacho, Rendición, Caja", () => {
    expect(links("encargada_delivery")).toEqual([
      ["/despacho", "Despacho"],
      ["/despacho/rendicion", "Rendición"],
      ["/caja", "Caja"],
    ]);
  });
  it("admin: every screen plus Rendición and Administración", () => {
    expect(links("admin")).toEqual([
      ["/caja", "Caja"],
      ["/mostrador", "Mostrador"],
      ["/despacho", "Despacho"],
      ["/despacho/rendicion", "Rendición"],
      ["/admin", "Administración"],
    ]);
  });
});

describe("activeNavHref", () => {
  const all = navLinksForRole("admin");
  it("highlights the most specific section only", () => {
    expect(activeNavHref("/despacho", all)).toBe("/despacho");
    expect(activeNavHref("/despacho/rendicion", all)).toBe("/despacho/rendicion");
    expect(activeNavHref("/despacho/rendicion/x", all)).toBe("/despacho/rendicion");
    expect(activeNavHref("/caja", all)).toBe("/caja");
  });
  it("is not fooled by a shared prefix", () => {
    expect(activeNavHref("/cajas", all)).toBeNull();
    expect(activeNavHref("/estacion", all)).toBeNull();
  });
});
