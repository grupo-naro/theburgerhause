import { getDb } from "@/db/client";
import { listShortages, type Shortage } from "@/lib/stock/queries";

/** The strip is a convenience: if its read fails, the shell renders without it. */
export async function loadShortages(): Promise<Shortage[]> {
  try {
    return await listShortages(getDb());
  } catch {
    console.error("stock-alert: shortages unavailable");
    return [];
  }
}
