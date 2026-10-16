import { describe, expect, it } from "vitest";
import { activeNavHref, navLinksFor } from "./nav";

const links = (...args: Parameters<typeof navLinksFor>) => navLinksFor(...args).map((l) => [l.href, l.label]);

describe("navLinksFor (role x station kind)", () => {
  it("cajera on a Mostrador station: Venta, Mostrador, Retiro en local (nothing of delivery)", () => {
    expect(links("cajera", "mostrador")).toEqual([
      ["/mostrador", "Venta"],
      ["/mostrador/pedidos", "Mostrador"],
      ["/retiro", "Retiro en local"],
    ]);
  });
  it("encargada on a Delivery station: Gestión Delivery and Rendición only", () => {
    expect(links("encargada_delivery", "delivery")).toEqual([
      ["/delivery", "Gestión Delivery"],
      ["/delivery/rendicion", "Rendición"],
    ]);
  });
  it("admin sees every workspace, the general views and Administración, whatever the station", () => {
    const expected = [
      ["/mostrador", "Venta"],
      ["/mostrador/pedidos", "Mostrador"],
      ["/retiro", "Retiro en local"],
      ["/delivery", "Gestión Delivery"],
      ["/delivery/rendicion", "Rendición"],
      ["/caja", "Vista general"],
      ["/despacho", "Tablero general"],
      ["/admin", "Administración"],
    ];
    expect(links("admin", null)).toEqual(expected);
    expect(links("admin", "mostrador")).toEqual(expected);
    expect(links("admin", "delivery")).toEqual(expected);
  });
  it("staff without a station get the workspaces of their role (the pages send them to pick a station)", () => {
    expect(links("cajera", null).map((l) => l[0])).toEqual(["/mostrador", "/mostrador/pedidos", "/retiro"]);
    expect(links("encargada_delivery", null).map((l) => l[0])).toEqual(["/delivery", "/delivery/rendicion"]);
  });
  it("a role/kind mismatch (unsupported combination) only offers to change the station", () => {
    expect(links("cajera", "delivery")).toEqual([["/estacion", "Cambiar estación"]]);
    expect(links("encargada_delivery", "mostrador")).toEqual([["/estacion", "Cambiar estación"]]);
  });
});

describe("activeNavHref", () => {
  const all = navLinksFor("admin", null);
  it("highlights the most specific section only", () => {
    expect(activeNavHref("/mostrador", all)).toBe("/mostrador");
    expect(activeNavHref("/mostrador/pedidos", all)).toBe("/mostrador/pedidos");
    expect(activeNavHref("/delivery", all)).toBe("/delivery");
    expect(activeNavHref("/delivery/rendicion", all)).toBe("/delivery/rendicion");
    expect(activeNavHref("/delivery/rendicion/x", all)).toBe("/delivery/rendicion");
    expect(activeNavHref("/caja", all)).toBe("/caja");
  });
  it("is not fooled by a shared prefix", () => {
    expect(activeNavHref("/cajas", all)).toBeNull();
    expect(activeNavHref("/estacion", all)).toBeNull();
    expect(activeNavHref("/deliveryx", all)).toBeNull();
  });
});
