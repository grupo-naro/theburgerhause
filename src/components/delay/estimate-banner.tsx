import { connection } from "next/server";
import { getDb } from "@/db/client";
import { getAcceptingOrders } from "@/lib/settings";
import { getPublicDelay, type PublicDelay } from "@/lib/delay/public";
import { EstimateNotice } from "./estimate-notice";

/**
 * Strongly consistent (uncached) estimate: keep it inside its own <Suspense> so the cached menu
 * shell stays static. Nothing while the store is closed (the closed banner is showing). A failing read renders nothing; the
 * client poll fills it in later.
 */
export async function EstimateBanner() {
  await connection();
  let initial: PublicDelay;
  try {
    if (!(await getAcceptingOrders(getDb()))) return null;
    initial = await getPublicDelay(getDb());
  } catch {
    return null;
  }
  return <EstimateNotice variant="menu" initial={initial} />;
}
