import { describe, expect, it } from "vitest";
import { legacyRedirectTarget, parseTab, tabLanes, tabsFor } from "./workspaces";

describe("tabsFor", () => {
  it("Gestión Delivery: Por aprobar, En preparación, Listos / Despacho, En camino, Recientes", () => {
    expect(tabsFor("delivery").map((t) => [t.id, t.label])).toEqual([
      ["pending", "Por aprobar"],
      ["preparing", "En preparación"],
      ["ready", "Listos / Despacho"],
      ["enroute", "En camino"],
      ["recent", "Recientes"],
    ]);
  });
  it("Retiro en local shows everything at once: no tabs", () => {
    expect(tabsFor("mostrador")).toEqual([]);
  });
});

describe("parseTab", () => {
  it("accepts the sector's own tabs, falls back to pending for anything else", () => {
    expect(parseTab("delivery", "enroute")).toBe("enroute");
    expect(parseTab("mostrador", "enroute")).toBe("pending"); // no tabs there: always the default
    expect(parseTab("delivery", undefined)).toBe("pending");
    expect(parseTab("delivery", ["ready", "recent"])).toBe("pending");
    expect(parseTab("delivery", "__proto__")).toBe("pending");
  });
});

describe("tabLanes", () => {
  it("each dispatch tab shows its lanes; pending and recent show none", () => {
    expect(tabLanes("preparing")).toEqual(["preparing"]);
    expect(tabLanes("ready")).toEqual(["ready"]);
    expect(tabLanes("enroute")).toEqual(["enroute"]);
    expect(tabLanes("pending")).toEqual([]);
    expect(tabLanes("recent")).toEqual([]);
  });
});

describe("legacyRedirectTarget (old URLs)", () => {
  it("/caja and /despacho send staff to their sector workspace, admin keeps the general views", () => {
    expect(legacyRedirectTarget("caja", "cajera")).toBe("/retiro");
    expect(legacyRedirectTarget("caja", "encargada_delivery")).toBe("/delivery");
    expect(legacyRedirectTarget("despacho", "cajera")).toBe("/mostrador/pedidos");
    expect(legacyRedirectTarget("despacho", "encargada_delivery")).toBe("/delivery");
    expect(legacyRedirectTarget("caja", "admin")).toBeNull();
    expect(legacyRedirectTarget("despacho", "admin")).toBeNull();
    expect(legacyRedirectTarget("caja", "cocina")).toBe("/pantalla");
    expect(legacyRedirectTarget("despacho", "cocina")).toBe("/pantalla");
    expect(legacyRedirectTarget("caja", "encargado")).toBeNull();
    expect(legacyRedirectTarget("despacho", "encargado")).toBeNull();
  });
});
