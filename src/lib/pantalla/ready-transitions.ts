/**
 * Which orders JUST entered "¡Listo!" on the counter TV (pure: the screen keeps the previous lists).
 *
 * Only an order that was in preparation on the previous render and is ready now chimes. An order that was already
 * ready (listo_despacho -> para_retirar), or that the screen sees for the first time directly in Ready (screen just
 * opened, or a missed refresh), does not. Going back from Ready to preparation never chimes: it just leaves Ready.
 * The caller additionally remembers what already chimed, so an order chimes once in its life ("first time only").
 */
export function newlyReady(prev: number[], next: number[], prevPreparing: number[]): number[] {
  const wasReady = new Set(prev);
  const wasPreparing = new Set(prevPreparing);
  const out: number[] = [];
  for (const id of next) {
    if (!wasReady.has(id) && wasPreparing.has(id) && !out.includes(id)) out.push(id);
  }
  return out;
}
