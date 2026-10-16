export const BASE_TITLE = "Despacho";

/** Tab title: `(N) Despacho` with N = delivery orders waiting to be assigned. */
export function buildDespachoTitle(toAssign: number): string {
  const n = Number.isFinite(toAssign) ? Math.max(0, Math.floor(toAssign)) : 0;
  return n > 0 ? `(${n}) ${BASE_TITLE}` : BASE_TITLE;
}
