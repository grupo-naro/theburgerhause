import { eq } from "drizzle-orm";
import sharp from "sharp";
import * as s from "../../src/db/schema";
import { saveImage } from "../../src/lib/uploads/storage";
import { db } from "./db";

/** The store promotion lives in one row (id 1). Tests write it straight to the test database. */
export async function setPromo(over: Partial<typeof s.storePromo.$inferInsert> = {}): Promise<string> {
  const png = await sharp({ create: { width: 600, height: 800, channels: 3, background: "#e67e22" } }).png().toBuffer();
  const { path } = await saveImage(png);
  const values = {
    imagePath: path,
    title: "EDICIÓN ESPECIAL HALLOWEEN",
    active: true,
    startsAt: null,
    endsAt: null,
    updatedAt: new Date(),
    ...over,
  };
  await db().insert(s.storePromo).values({ id: 1, ...values }).onConflictDoUpdate({ target: s.storePromo.id, set: values });
  return path;
}

/** Leaves the shared test database without a promotion (nothing shows). */
export async function clearPromo(): Promise<void> {
  await db().delete(s.storePromo).where(eq(s.storePromo.id, 1));
}
