import { eq } from "drizzle-orm";
import { closeDb, getDb } from "../../src/db/client";
import * as schema from "../../src/db/schema";
import { createOrder } from "../../src/lib/orders/create-order";

/**
 * Prints (as one JSON line) what the Lighthouse run needs from the seeded TEST database: two product ids for the
 * pre-filled cart and the token of a fresh order for the tracking page. Run with the perf server environment
 * (DATABASE_URL = test database): scripts/perf/lighthouse.mjs spawns it through tsx.
 */
async function main(): Promise<void> {
  const db = getDb();
  const [ranchita] = await db.select().from(schema.products).where(eq(schema.products.name, "Ranchita simple"));
  const [melt] = await db.select().from(schema.products).where(eq(schema.products.name, "Melt simple"));
  if (!ranchita || !melt) throw new Error("seed products missing: seed the test database first");
  const placed = await createOrder(db, {
    idempotencyKey: crypto.randomUUID(),
    units: [{ productId: ranchita.id, modifierIds: [], note: "" }],
    customer: { name: "Perf Test", whatsapp: "11 5555-0101" },
    fulfillment: "takeaway",
    paymentMethod: "cash",
    bh_ref: "",
  });
  if (!placed.ok) throw new Error(`could not create the tracking order: ${placed.code}`);
  console.log(JSON.stringify({ ranchitaId: ranchita.id, meltId: melt.id, token: placed.data.publicToken }));
  await closeDb();
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
