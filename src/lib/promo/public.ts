import type { Db, DbTransaction } from "@/db/client";
import { uploadUrl } from "@/lib/uploads/storage";
import { getPromo } from "./admin";
import { isPromoShowing, promoVersion } from "./window";

/** What the storefront gets: only a promotion that is showing right now, nothing else about the row. */
export type PublicPromo = { version: string; imageUrl: string; title: string | null };

/** Strongly consistent (uncached) read: the time window is evaluated at request time. */
export async function getPublicPromo(db: Db | DbTransaction, now: Date = new Date()): Promise<PublicPromo | null> {
  const row = await getPromo(db);
  if (!row || !row.imagePath || !isPromoShowing(row, now)) return null;
  return { version: promoVersion(row), imageUrl: uploadUrl(row.imagePath), title: row.title };
}
