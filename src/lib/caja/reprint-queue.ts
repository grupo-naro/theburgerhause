import type { PrintKind, PrintWhich } from "@/lib/orders/print-kinds";

/**
 * The reprints that bring back exactly these ticket kinds: the kitchen comanda first (its own reprint,
 * never folded into "both"), then customer / delivery ("both" when both of them are needed). Pure.
 */
export function reprintsFor(kinds: Iterable<PrintKind>): PrintWhich[] {
  const set = new Set(kinds);
  const tickets = (["customer", "delivery"] as const).filter((k) => set.has(k));
  return [...(set.has("kitchen") ? (["kitchen"] as const) : []), ...(tickets.length > 1 ? (["both"] as const) : tickets)];
}

/**
 * Queues the reprints one after the other, stopping at the first refusal. `queued` remembers what already
 * went through, so a retry after a partial failure only queues the rest (no duplicated comanda).
 */
export async function queueReprints<R extends { ok: boolean }>(
  which: PrintWhich[],
  queued: Set<string>,
  call: (which: PrintWhich) => Promise<R>,
): Promise<R | { ok: true }> {
  let last: R | { ok: true } = { ok: true };
  for (const w of which) {
    if (queued.has(w)) continue;
    const r = await call(w);
    if (!r.ok) return r;
    queued.add(w);
    last = r;
  }
  return last;
}
