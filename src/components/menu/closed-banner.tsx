import { connection } from "next/server";
import { getDb } from "@/db/client";
import { getPublicStoreInfo } from "@/lib/menu/queries";
import { getAcceptingOrders } from "@/lib/settings";
import { ClosedNotice } from "./closed-notice";

/**
 * Strongly consistent (uncached) read of `accepting_orders`: keep it inside a
 * <Suspense> boundary so the rest of the page stays in the static shell.
 */
export async function ClosedBanner() {
  await connection();
  const open = await getAcceptingOrders(getDb());
  if (open) return null;
  const { openingHoursText } = await getPublicStoreInfo();
  return <ClosedNotice hours={openingHoursText} />;
}
