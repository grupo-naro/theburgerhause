import { connection } from "next/server";
import { getDb } from "@/db/client";
import { getPublicDelay, type PublicDelay } from "@/lib/delay/public";
import { EstimateNotice } from "./estimate-notice";

/**
 * Strongly consistent (uncached) estimate: keep it inside its own <Suspense> so the cached menu
 * shell stays static. A failing read renders nothing; the client poll fills it in later.
 */
export async function EstimateBanner() {
  await connection();
  let initial: PublicDelay;
  try {
    initial = await getPublicDelay(getDb());
  } catch {
    return null;
  }
  return <EstimateNotice variant="menu" initial={initial} />;
}
