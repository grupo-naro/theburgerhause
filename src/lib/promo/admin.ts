import { eq } from "drizzle-orm";
import type { Db, DbTransaction } from "@/db/client";
import * as s from "@/db/schema";
import { UNEXPECTED, zodFieldErrors, type Result } from "@/lib/menu/admin";
import { deleteImage as defaultDeleteImage } from "@/lib/uploads/storage";
import { promoInputSchema } from "./schemas";

/** Admin writes of the store promotion (single row, id 1). No next/* imports. */

type Conn = Db | DbTransaction;
export type PromoDeps = { deleteImage?: (name: string) => Promise<void> };
export type PromoRow = typeof s.storePromo.$inferSelect;

export async function getPromo(db: Conn): Promise<PromoRow | null> {
  const [row] = await db.select().from(s.storePromo).where(eq(s.storePromo.id, 1));
  return row ?? null;
}

export async function savePromo(db: Conn, input: unknown, deps: PromoDeps = {}): Promise<Result<null>> {
  const parsed = promoInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: zodFieldErrors(parsed.error.issues) };
  const v = parsed.data;
  // An active promotion needs something to show; saving it off without an image is fine (a draft).
  if (v.active && !v.imagePath) return { ok: false, fieldErrors: { imagePath: "Subí una imagen para activar la promoción" } };

  try {
    const previous = await (db as Db).transaction(async (tx) => {
      const [old] = await tx.select({ imagePath: s.storePromo.imagePath }).from(s.storePromo).where(eq(s.storePromo.id, 1));
      const values = { imagePath: v.imagePath, title: v.title, active: v.active, startsAt: v.startsAt, endsAt: v.endsAt, updatedAt: new Date() };
      await tx
        .insert(s.storePromo)
        .values({ id: 1, ...values })
        .onConflictDoUpdate({ target: s.storePromo.id, set: values });
      return old?.imagePath ?? null;
    });
    // Replaced or removed image: drop the old files once the new row is committed.
    if (previous && previous !== v.imagePath) {
      try {
        await (deps.deleteImage ?? defaultDeleteImage)(previous);
      } catch {
        console.error("[promo] no se pudo borrar la imagen anterior");
      }
    }
    return { ok: true, data: null };
  } catch {
    console.error("[promo] savePromo failed");
    return { ok: false, error: UNEXPECTED };
  }
}
