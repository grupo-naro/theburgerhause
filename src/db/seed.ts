import path from "node:path";
import { and, eq, inArray, sql } from "drizzle-orm";
import { closeDb, getDb, type Db } from "@/db/client";
import * as s from "@/db/schema";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { DEPLOYMENT_KEY } from "@/db/deployment";

/**
 * Idempotent seed: every insert is keyed on a natural unique key, so running
 * it again changes nothing. It creates NO users (Task 2.2 owns admin creation).
 * Prices are centavos.
 */

const CATEGORIES = [
  "Mila al plato",
  "Combo con papa junior",
  "Cajita mundial",
  "Combos",
  "Sándwich de mila",
  "Chicken sándwich de nuggets",
  "Kids",
  "Hamburguesa simple + papa chica",
  "Hamburguesa doble + papa chica",
];

function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const SIMPLE = "Hamburguesa simple + papa chica";
const DOUBLE = "Hamburguesa doble + papa chica";

// [category, name, description, price, featured]
const PRODUCTS: [string, string, string, number, boolean][] = [
  [SIMPLE, "Ranchita simple", "Medallón de carne, cheddar y salsa ranchera", 850000, true],
  [SIMPLE, "Melt simple", "Medallón de carne, cheddar fundido y cebolla", 880000, true],
  [SIMPLE, "Cuarto de libra simple", "Medallón de cuarto de libra, cheddar y pickles", 920000, false],
  [SIMPLE, "Holtber extreme simple", "Medallón de carne, panceta, cheddar y salsa especial", 980000, true],
  [SIMPLE, "828 simple", "La clásica de la casa con salsa tasty", 870000, false],
  [SIMPLE, "Huevo simple", "Medallón de carne, huevo y cheddar", 900000, false],
  [SIMPLE, "Aro simple", "Medallón de carne, aro de cebolla y barbacoa", 910000, false],
  [DOUBLE, "Ranchita doble", "Doble medallón, cheddar y salsa ranchera", 1150000, false],
  [DOUBLE, "Melt doble", "Doble medallón, cheddar fundido y cebolla", 1190000, false],
  [DOUBLE, "Cuarto de libra doble", "Doble cuarto de libra, cheddar y pickles", 1290000, false],
  [DOUBLE, "Holtber extreme doble", "Doble medallón, panceta, cheddar y salsa especial", 1350000, true],
];

// group -> [kind, name, priceDelta, kitchenLabel]
const MODIFIER_GROUPS: Record<string, ["remove" | "add" | "swap", string, number, string][]> = {
  "Quitar ingredientes": [
    ["remove", "Sin cheddar", 0, "SIN CHEDDAR"],
    ["remove", "Sin lechuga", 0, "SIN LECHUGA"],
    ["remove", "Sin tomate", 0, "SIN TOMATE"],
  ],
  Agregados: [
    ["add", "+ Dips de cheddar", 120000, "+ DIPS CHEDDAR"],
    ["add", "+ Salsa tasty en papas", 80000, "+ SALSA TASTY PAPAS"],
    ["add", "Agregar tomate", 30000, "+ TOMATE"],
    ["add", "Agregar lechuga y tomate", 50000, "+ LECHUGA Y TOMATE"],
  ],
  Papas: [["swap", "Cambiar a papas grandes", 100000, "PAPAS GRANDES"]],
};

const STATIONS = [
  { name: "Mostrador 1", kind: "mostrador" },
  { name: "Delivery 1", kind: "delivery" },
] as const;

const CADETS = ["Cadete 1", "Cadete 2", "Cadete 3"];

/** Earlier seeds stored this misspelled name; it is corrected on re-seed (only when untouched). */
const LEGACY_STORE_NAME = "The Burger Hause";

const SETTINGS: Record<string, unknown> = {
  store_name: DEFAULT_SETTINGS.storeName,
  store_address: "",
  bank_alias: "",
  bank_cbu: "",
  delivery_fee: 150000,
  accepting_orders: true,
};

/**
 * The demo seed loads fake products/prices/stations/cadets and OPEN settings: it must never reach a real
 * database. In production use `pnpm db:init-prod`. Override only with ALLOW_DEMO_SEED=1 (exactly).
 */
export function assertSeedAllowed(env: Record<string, string | undefined>): void {
  if (env.NODE_ENV === "production" && env.ALLOW_DEMO_SEED !== "1") {
    throw new Error(
      [
        "REFUSING TO RUN: pnpm db:seed loads DEMO products, prices, stations and cadets and must NEVER run in production (NODE_ENV=production).",
        "For a real installation run: pnpm db:init-prod",
        "If you are sure this is a throwaway database, set ALLOW_DEMO_SEED=1 explicitly.",
      ].join("\n"),
    );
  }
}

/** Refuses to seed a database marked as production by init-prod (unless ALLOW_DEMO_SEED=1). */
async function assertDbNotProduction(db: Db): Promise<void> {
  if (process.env.ALLOW_DEMO_SEED === "1") return;
  const [row] = await db
    .select({ value: sql<string>`${s.settings.value}::text` })
    .from(s.settings)
    .where(eq(s.settings.key, DEPLOYMENT_KEY));
  if (row?.value === '"production"') {
    throw new Error(
      [
        "SE RECHAZA EL SEED DE DEMO: esta base de datos esta marcada como PRODUCCION (deployment=production, escrito por pnpm db:init-prod).",
        "El seed de demo carga productos, precios, estaciones y cadetes FALSOS y NUNCA debe correr en produccion.",
        "Cargá el menú real desde el panel de Admin. Si esta base es descartable, ALLOW_DEMO_SEED=1 lo permite explicitamente.",
      ].join("\n"),
    );
  }
}

export async function seed(db: Db): Promise<void> {
  await assertDbNotProduction(db);
  await db.transaction(async (tx) => {
    await tx
      .insert(s.categories)
      .values(CATEGORIES.map((name, i) => ({ name, slug: slugify(name), sort: i })))
      .onConflictDoNothing({ target: s.categories.slug });
    const cats = await tx.select().from(s.categories);
    const catId = new Map(cats.map((c) => [c.name, c.id]));

    await tx
      .insert(s.products)
      .values(
        PRODUCTS.map(([cat, name, description, price, featured], i) => ({
          categoryId: catId.get(cat)!,
          name,
          description,
          price,
          featured,
          sort: i,
        })),
      )
      .onConflictDoNothing({ target: [s.products.categoryId, s.products.name] });

    await tx
      .insert(s.modifierGroups)
      .values(Object.keys(MODIFIER_GROUPS).map((name) => ({ name })))
      .onConflictDoNothing({ target: s.modifierGroups.name });
    const groups = await tx.select().from(s.modifierGroups);
    const groupId = new Map(groups.map((g) => [g.name, g.id]));

    const modifierRows = Object.entries(MODIFIER_GROUPS).flatMap(([group, mods]) =>
      mods.map(([kind, name, priceDelta, kitchenLabel], i) => ({
        groupId: groupId.get(group)!,
        kind,
        name,
        priceDelta,
        kitchenLabel,
        sort: i,
      })),
    );
    await tx
      .insert(s.modifiers)
      .values(modifierRows)
      .onConflictDoNothing({ target: [s.modifiers.groupId, s.modifiers.name] });

    // Burgers (simple + double) can be customised with every group.
    const burgers = await tx
      .select({ id: s.products.id })
      .from(s.products)
      .where(inArray(s.products.categoryId, [catId.get(SIMPLE)!, catId.get(DOUBLE)!]));
    await tx
      .insert(s.productModifierGroups)
      .values(burgers.flatMap((b) => groups.map((g) => ({ productId: b.id, groupId: g.id }))))
      .onConflictDoNothing();

    await tx
      .insert(s.stations)
      .values([...STATIONS])
      .onConflictDoNothing({ target: s.stations.name });

    const existingCadets = new Set((await tx.select({ name: s.cadets.name }).from(s.cadets)).map((c) => c.name));
    const newCadets = CADETS.filter((name) => !existingCadets.has(name));
    if (newCadets.length > 0) {
      await tx.insert(s.cadets).values(newCadets.map((name) => ({ name })));
    }

    await tx
      .insert(s.settings)
      .values(Object.entries(SETTINGS).map(([key, value]) => ({ key, value })))
      .onConflictDoNothing({ target: s.settings.key });

    // Fix the old typo, but never clobber a name the admin customized.
    await tx
      .update(s.settings)
      .set({ value: DEFAULT_SETTINGS.storeName })
      .where(
        and(eq(s.settings.key, "store_name"), sql`${s.settings.value} = ${JSON.stringify(LEGACY_STORE_NAME)}::jsonb`),
      );
  });
}

// Run only when executed directly (`pnpm db:seed`), not when imported by tests.
if (process.argv[1] && path.basename(process.argv[1]) === "seed.ts") {
  try {
    process.loadEnvFile?.();
  } catch {
    // no .env file; rely on the existing environment
  }
  try {
    assertSeedAllowed(process.env);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
  seed(getDb())
    .then(() => console.log("Seed complete."))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => closeDb());
}

