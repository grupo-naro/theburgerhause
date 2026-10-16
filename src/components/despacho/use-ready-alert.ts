"use client";

import { useEffect, useRef, useState } from "react";
import { detectNewOrders } from "@/lib/caja/new-orders";

export const FLASH_MS = 4000;

type Watched = { id: number; number: number };

/**
 * Orders that just arrived in the "Listos" lanes: a ring on the new card (~4 s) and a polite
 * live-region message. The FIRST render never announces; ids already seen never re-announce.
 */
/**
 * NOTE (by design): `seen` is cumulative, so an order returned to dispatch (en camino -> listo) was
 * already seen and does not flash or announce again; only orders new to the board do.
 */
export function useReadyAlert(orders: Watched[]) {
  const seen = useRef<Set<number> | null>(null);
  const [freshIds, setFreshIds] = useState<ReadonlySet<number>>(new Set());
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    const fresh = detectNewOrders(seen.current, orders);
    seen.current = new Set([...(seen.current ?? []), ...orders.map((o) => o.id)]);
    if (fresh.length === 0) return;
    const numbers = orders.filter((o) => fresh.includes(o.id)).map((o) => `#${o.number}`);
    // Timers are intentionally not cleared on the next render: the highlight must expire.
    window.setTimeout(() => {
      setFreshIds((prev) => new Set([...prev, ...fresh]));
      setAnnouncement(fresh.length === 1 ? `Pedido ${numbers[0]} listo para despachar` : `Pedidos ${numbers.join(", ")} listos para despachar`);
    }, 0);
    window.setTimeout(() => setFreshIds((prev) => new Set([...prev].filter((id) => !fresh.includes(id)))), FLASH_MS);
  }, [orders]);

  return { freshIds, announcement };
}
