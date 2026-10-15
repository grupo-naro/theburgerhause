import { describe, expect, it } from "vitest";
import { formatARS } from "@/domain/money";
import { orderTotals } from "@/domain/pricing";
import { menuFixture, papasFritas, ranchita } from "./fixtures";
import { buildMenuIndex } from "./pricing";
import {
  canCopyFromFirst,
  copyFromFirst,
  initSheet,
  modifierDisplay,
  setExpanded,
  setNote,
  setQuantity,
  sheetTotal,
  toggleModifier,
  toUnitConfigs,
  unitSummary,
} from "./sheet-state";
import type { CartGroup } from "./types";

const index = buildMenuIndex(menuFixture);
const modifierOf = (id: number) => index.modifiers.get(id)!.modifier;

describe("initSheet", () => {
  it("add mode starts with one empty unit, expanded", () => {
    expect(initSheet(ranchita)).toEqual({
      productId: 1,
      mode: "add",
      units: [{ modifierIds: [], note: "" }],
      expanded: 0,
    });
  });

  it("edit mode takes quantity and configuration from the group", () => {
    const group: CartGroup = {
      signature: "1|101,201|sin sal",
      productId: 1,
      modifierIds: [101, 201],
      note: "sin sal",
      quantity: 3,
      lineIds: ["a", "b", "c"],
    };
    const s = initSheet(ranchita, { editGroup: group });
    expect(s.mode).toBe("edit");
    expect(s.editSignature).toBe(group.signature);
    expect(s.units).toHaveLength(3);
    expect(s.units.every((u) => u.note === "sin sal" && u.modifierIds.join() === "101,201")).toBe(true);
    // units must not share the same array instance
    expect(s.units[0].modifierIds).not.toBe(s.units[1].modifierIds);
  });
});

describe("setQuantity", () => {
  it("growing appends EMPTY units and keeps existing selections", () => {
    let s = initSheet(ranchita);
    s = toggleModifier(s, 0, 101, index);
    s = setQuantity(s, 3);
    expect(s.units).toEqual([
      { modifierIds: [101], note: "" },
      { modifierIds: [], note: "" },
      { modifierIds: [], note: "" },
    ]);
  });

  it("shrinking truncates from the end and keeps the first N selections", () => {
    let s = setQuantity(initSheet(ranchita), 3);
    s = toggleModifier(s, 0, 101, index);
    s = toggleModifier(s, 1, 102, index);
    s = toggleModifier(s, 2, 201, index);
    s = setQuantity(s, 2);
    expect(s.units.map((u) => u.modifierIds)).toEqual([[101], [102]]);
  });

  it("clamps to 1..10 and keeps expanded inside the range", () => {
    let s = setQuantity(initSheet(ranchita), 99);
    expect(s.units).toHaveLength(10);
    s = setExpanded(s, 9);
    s = setQuantity(s, 0);
    expect(s.units).toHaveLength(1);
    expect(s.expanded).toBe(0);
    expect(setQuantity(s, Number.NaN).units).toHaveLength(1);
  });

  it("an edited group bigger than 10 can shrink but not grow", () => {
    const group: CartGroup = { signature: "s", productId: 1, modifierIds: [], note: "", quantity: 15, lineIds: [] };
    const s = initSheet(ranchita, { editGroup: group });
    expect(s.units).toHaveLength(15);
    expect(setQuantity(s, 20).units).toHaveLength(15);
    expect(setQuantity(s, 12).units).toHaveLength(12);
  });
});

describe("toggleModifier", () => {
  it("toggles remove/add kinds independently", () => {
    let s = initSheet(ranchita);
    s = toggleModifier(s, 0, 101, index);
    s = toggleModifier(s, 0, 201, index);
    expect(s.units[0].modifierIds).toEqual([101, 201]);
    s = toggleModifier(s, 0, 101, index);
    expect(s.units[0].modifierIds).toEqual([201]);
  });

  it("swap kinds are exclusive within their group, not across groups, and can be deselected", () => {
    let s = initSheet(ranchita);
    s = toggleModifier(s, 0, 301, index);
    s = toggleModifier(s, 0, 311, index); // other group: both stay
    s = toggleModifier(s, 0, 302, index); // same group: replaces 301
    expect(s.units[0].modifierIds).toEqual([302, 311]);
    s = toggleModifier(s, 0, 302, index);
    expect(s.units[0].modifierIds).toEqual([311]);
  });

  it("only touches the given unit and ignores unknown ids / indexes", () => {
    let s = setQuantity(initSheet(ranchita), 2);
    s = toggleModifier(s, 1, 101, index);
    expect(s.units.map((u) => u.modifierIds)).toEqual([[], [101]]);
    expect(toggleModifier(s, 1, 99999, index)).toBe(s);
    expect(toggleModifier(s, 7, 101, index)).toBe(s);
  });
});

describe("copyFromFirst", () => {
  it("copies unit 1 modifiers AND note into the target unit", () => {
    let s = setQuantity(initSheet(ranchita), 2);
    s = toggleModifier(s, 0, 101, index);
    s = toggleModifier(s, 0, 201, index);
    s = setNote(s, 0, "bien cocida");
    s = copyFromFirst(s, 1);
    expect(s.units[1]).toEqual({ modifierIds: [101, 201], note: "bien cocida" });
    expect(s.units[1].modifierIds).not.toBe(s.units[0].modifierIds);
  });

  it("is a no-op for unit 0 and out of range indexes", () => {
    const s = setQuantity(initSheet(ranchita), 2);
    expect(copyFromFirst(s, 0)).toBe(s);
    expect(copyFromFirst(s, 5)).toBe(s);
  });

  it("canCopyFromFirst is false when unit 1 is empty or identical", () => {
    let s = setQuantity(initSheet(ranchita), 2);
    expect(canCopyFromFirst(s, 1)).toBe(false);
    s = toggleModifier(s, 0, 101, index);
    expect(canCopyFromFirst(s, 1)).toBe(true);
    expect(canCopyFromFirst(s, 0)).toBe(false);
    s = copyFromFirst(s, 1);
    expect(canCopyFromFirst(s, 1)).toBe(false);
  });
});

describe("setNote", () => {
  it("clamps to 140 characters and keeps typing whitespace until output", () => {
    let s = initSheet(ranchita);
    s = setNote(s, 0, "x".repeat(200));
    expect(s.units[0].note).toHaveLength(140);
    s = setNote(s, 0, "hola ");
    expect(s.units[0].note).toBe("hola ");
    expect(toUnitConfigs(s)[0].note).toBe("hola");
  });
});

describe("unitSummary", () => {
  it("lists selected names in DISPLAY order (group order, then modifier order)", () => {
    let s = initSheet(ranchita);
    // selected in a scrambled order
    s = toggleModifier(s, 0, 311, index);
    s = toggleModifier(s, 0, 201, index);
    s = toggleModifier(s, 0, 102, index);
    expect(unitSummary(s, 0, index)).toEqual(["Sin lechuga", "Dips de cheddar", "Gaseosa grande"]);
  });

  it("is empty for an empty unit or an unknown index", () => {
    const s = initSheet(ranchita);
    expect(unitSummary(s, 0, index)).toEqual([]);
    expect(unitSummary(s, 4, index)).toEqual([]);
  });
});

describe("sheetTotal", () => {
  it("equals the domain orderTotals for 1 unit", () => {
    let s = initSheet(ranchita);
    s = toggleModifier(s, 0, 201, index); // + 1200
    const expected = orderTotals([{ basePrice: ranchita.price, modifiers: [{ priceDelta: 120000 }] }], 0).subtotal;
    expect(sheetTotal(s, ranchita)).toBe(expected);
    expect(sheetTotal(s, ranchita)).toBe(970000);
  });

  it("equals the domain orderTotals for 3 units with different selections", () => {
    let s = setQuantity(initSheet(ranchita), 3);
    s = toggleModifier(s, 0, 101, index); // free
    s = toggleModifier(s, 1, 201, index); // +1200
    s = toggleModifier(s, 1, 301, index); // +1000
    s = toggleModifier(s, 2, 202, index); // +500
    const expected = orderTotals(
      [
        { basePrice: 850000, modifiers: [{ priceDelta: 0 }] },
        { basePrice: 850000, modifiers: [{ priceDelta: 120000 }, { priceDelta: 100000 }] },
        { basePrice: 850000, modifiers: [{ priceDelta: 50000 }] },
      ],
      0,
    ).subtotal;
    expect(sheetTotal(s, ranchita)).toBe(expected);
    expect(sheetTotal(s, ranchita)).toBe(850000 * 3 + 120000 + 100000 + 50000);
  });

  it("ignores modifiers the product does not offer", () => {
    let s = initSheet(papasFritas);
    s = { ...s, units: [{ modifierIds: [301], note: "" }] };
    expect(sheetTotal(s, papasFritas)).toBe(papasFritas.price);
  });
});

describe("toUnitConfigs", () => {
  it("sorts ids, dedupes and trims notes", () => {
    let s = setQuantity(initSheet(ranchita), 2);
    s = { ...s, units: [{ modifierIds: [201, 101, 201], note: "  sin sal  " }, s.units[1]] };
    expect(toUnitConfigs(s)).toEqual([
      { modifierIds: [101, 201], note: "sin sal" },
      { modifierIds: [], note: "" },
    ]);
  });
});

describe("modifierDisplay", () => {
  it("keeps the stored name for remove kinds and shows no price when free", () => {
    expect(modifierDisplay(modifierOf(101))).toEqual({ label: "Sin cheddar", priceLabel: null, kind: "remove" });
  });

  it("shows the price only when the delta is positive", () => {
    const d = modifierDisplay(modifierOf(201));
    expect(d.priceLabel).toBe(`+ ${formatARS(120000)}`);
    expect(d.kind).toBe("add");
    expect(modifierDisplay(modifierOf(301)).priceLabel).toBe(`+ ${formatARS(100000)}`);
    expect(modifierDisplay({ id: 9, name: "Gratis", kind: "swap", priceDelta: 0 }).priceLabel).toBeNull();
  });
});
