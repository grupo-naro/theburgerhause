/**
 * Ids in `nextOrders` that were not in `prevIds`, in list order, without duplicates.
 * `prevIds === null` is the first render: it never alerts. The caller keeps the EVER-SEEN set,
 * so a card that leaves and comes back (a refresh glitch) is not announced again.
 */
export function detectNewOrders(
  prevIds: Iterable<number> | null,
  nextOrders: ReadonlyArray<{ id: number }>,
): number[] {
  if (prevIds === null) return [];
  const seen = new Set(prevIds);
  const fresh: number[] = [];
  for (const { id } of nextOrders) {
    if (seen.has(id)) continue;
    seen.add(id);
    fresh.push(id);
  }
  return fresh;
}
