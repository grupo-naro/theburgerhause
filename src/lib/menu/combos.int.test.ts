import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { comboSeparatePrice, getComboItems, setComboItems } from "./combos";

const db = () => testDb();
let fx: { combo: number; combo2: number; burger: number; coke: number };

beforeEach(async () => {
  await resetDb();
  const [c] = await db().insert(s.categories).values({ name: "Combos", slug: "combos" }).returning();
  const [combo, combo2, burger, coke] = await db()
    .insert(s.products)
    .values([
      { categoryId: c.id, name: "Combo para 4", price: 4_000_000 },
      { categoryId: c.id, name: "Combo mundial", price: 1_200_000 },
      { categoryId: c.id, name: "Holtber simple", price: 980_000 },
      { categoryId: c.id, name: "Coca 500", price: 250_000 },
    ])
    .returning({ id: s.products.id });
  fx = { combo: combo.id, combo2: combo2.id, burger: burger.id, coke: coke.id };
});
afterAll(closeDb);

describe("combo contents", () => {
  it("set and read the contents in menu order of insertion, with names and prices", async () => {
    expect(await setComboItems(db(), fx.combo, [{ productId: fx.burger, quantity: 4 }, { productId: fx.coke, quantity: 2 }])).toEqual({ ok: true, data: null });
    expect(await getComboItems(db(), fx.combo)).toEqual([
      { productId: fx.burger, name: "Holtber simple", quantity: 4, price: 980_000, active: true },
      { productId: fx.coke, name: "Coca 500", quantity: 2, price: 250_000, active: true },
    ]);
    expect(await comboSeparatePrice(db(), fx.combo)).toBe(4 * 980_000 + 2 * 250_000);
  });

  it("replacing the contents removes what is not in the new list; an empty list makes it a normal product", async () => {
    await setComboItems(db(), fx.combo, [{ productId: fx.burger, quantity: 4 }, { productId: fx.coke, quantity: 2 }]);
    await setComboItems(db(), fx.combo, [{ productId: fx.coke, quantity: 1 }]);
    expect((await getComboItems(db(), fx.combo)).map((i) => [i.productId, i.quantity])).toEqual([[fx.coke, 1]]);
    await setComboItems(db(), fx.combo, []);
    expect(await getComboItems(db(), fx.combo)).toEqual([]);
  });

  it("refuses itself, nesting, unknown products, bad quantities and duplicates", async () => {
    const err = async (items: { productId: number; quantity: number }[], combo = fx.combo) => {
      const r = await setComboItems(db(), combo, items);
      return r.ok ? null : r.error;
    };
    expect(await err([{ productId: fx.combo, quantity: 1 }])).toBe("Un combo no puede incluirse a sí mismo");
    await setComboItems(db(), fx.combo2, [{ productId: fx.burger, quantity: 1 }]);
    expect(await err([{ productId: fx.combo2, quantity: 1 }])).toBe("Un combo no puede incluir otro combo");
    // A product that is already inside a combo cannot become a combo itself.
    await setComboItems(db(), fx.combo, [{ productId: fx.coke, quantity: 1 }]);
    expect(await err([{ productId: fx.burger, quantity: 1 }], fx.coke)).toBe("Este producto está dentro de un combo: no puede ser un combo");
    expect(await err([{ productId: 999_999, quantity: 1 }])).toBe("Algún producto elegido no existe");
    expect(await err([{ productId: fx.burger, quantity: 0 }])).toBe("La cantidad va de 1 a 20");
    expect(await err([{ productId: fx.burger, quantity: 21 }])).toBe("La cantidad va de 1 a 20");
    expect(await err([{ productId: fx.burger, quantity: 1 }, { productId: fx.burger, quantity: 2 }])).toBe("Cada producto va una sola vez");
  });

  it("an unknown combo is refused", async () => {
    expect(await setComboItems(db(), 999_999, [])).toEqual({ ok: false, error: "El producto no existe" });
  });
});
