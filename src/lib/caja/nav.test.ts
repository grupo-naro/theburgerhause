import { describe, expect, it } from "vitest";
import { activeNavHref, navLinksFor } from "./nav";

const links = (...args: Parameters<typeof navLinksFor>) => navLinksFor(...args).map((l) => [l.href, l.label]);

describe("navLinksFor (role x station kind)", () => {
  it("cajera on a Mostrador station: Venta and Mostrador (app takeaway lives in Mostrador; nothing of delivery)", () => {
    expect(links("cajera", "mostrador")).toEqual([
      ["/mostrador", "Venta"],
      ["/mostrador/pedidos", "Mostrador"],
      ["/pantalla", "Pantalla"],
      ["/stock", "Stock"],
    ]);
  });
  it("encargada on a Delivery station: Gestión Delivery, Rendición and Pantalla", () => {
    expect(links("encargada_delivery", "delivery")).toEqual([
      ["/delivery", "Gestión Delivery"],
      ["/delivery/rendicion", "Rendición"],
      ["/pantalla", "Pantalla"],
      ["/stock", "Stock"],
    ]);
  });
  it("admin sees every workspace, the general views and Administración, whatever the station", () => {
    const expected = [
      ["/mostrador", "Venta"],
      ["/mostrador/pedidos", "Mostrador"],
      ["/delivery", "Gestión Delivery"],
      ["/delivery/rendicion", "Rendición"],
      ["/pantalla", "Pantalla"],
      ["/stock", "Stock"],
      ["/caja", "Vista general"],
      ["/despacho", "Tablero general"],
      ["/admin", "Administración"],
    ];
    expect(links("admin", null)).toEqual(expected);
    expect(links("admin", "mostrador")).toEqual(expected);
    expect(links("admin", "delivery")).toEqual(expected);
  });
  it("encargado sees both workspaces, Pantalla, the general views and Administración, whatever the station", () => {
    const expected = links("admin", null);
    expect(links("encargado", null)).toEqual(expected);
    expect(links("encargado", "mostrador")).toEqual(expected);
    expect(links("encargado", "delivery")).toEqual(expected);
    expect(expected.map((l) => l[1])).toEqual(expect.arrayContaining(["Venta", "Gestión Delivery", "Pantalla", "Administración"]));
  });
  it("staff without a station get the workspaces of their role (the pages send them to pick a station)", () => {
    expect(links("cajera", null).map((l) => l[0])).toEqual(["/mostrador", "/mostrador/pedidos", "/pantalla", "/stock"]);
    expect(links("encargada_delivery", null).map((l) => l[0])).toEqual(["/delivery", "/delivery/rendicion", "/pantalla", "/stock"]);
  });
  it("the counter screen link opens in a new tab and no link points at the old kitchen screen", () => {
    for (const [role, kind] of [["cajera", "mostrador"], ["encargada_delivery", "delivery"], ["admin", null], ["encargado", null], ["cocina", null]] as const) {
      const all = navLinksFor(role, kind);
      expect(all.find((l) => l.href === "/pantalla")?.newTab, role).toBe(true);
      expect(all.some((l) => l.href === "/cocina" || l.label === "Cocina"), role).toBe(false);
    }
  });
  it("the cocina role only sees the counter screen and the read-only stock", () => {
    expect(links("cocina", null)).toEqual([["/pantalla", "Pantalla"], ["/stock", "Stock"]]);
    expect(links("cocina", "mostrador")).toEqual([["/pantalla", "Pantalla"], ["/stock", "Stock"]]);
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
    expect(activeNavHref("/pantalla", all)).toBe("/pantalla");
  });
  it("is not fooled by a shared prefix", () => {
    expect(activeNavHref("/cajas", all)).toBeNull();
    expect(activeNavHref("/estacion", all)).toBeNull();
    expect(activeNavHref("/deliveryx", all)).toBeNull();
  });
});

describe("Retiro en local is gone", () => {
  it("no role gets a /retiro link", () => {
    for (const [role, kind] of [["cajera", "mostrador"], ["cajera", null], ["admin", null], ["encargado", null]] as const) {
      expect(navLinksFor(role, kind).some((l) => l.href === "/retiro"), role).toBe(false);
    }
  });
});
