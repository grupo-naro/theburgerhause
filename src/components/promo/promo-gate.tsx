import { connection } from "next/server";
import { getDb } from "@/db/client";
import { getPublicPromo } from "@/lib/promo/public";
import { PromoModal } from "./promo-modal";

/**
 * Reads the promotion UNCACHED at request time (one primary-key row) and evaluates its schedule
 * against the current time right here, so it starts and stops on the minute and an admin save is
 * visible on the very next page load. Keep it inside a <Suspense fallback={null}> so the rest of
 * the page stays in the static shell. A failing read just means no promotion.
 */
export async function PromoGate() {
  await connection();
  let promo;
  try {
    promo = await getPublicPromo(getDb());
  } catch {
    return null;
  }
  return promo ? <PromoModal promo={promo} /> : null;
}
