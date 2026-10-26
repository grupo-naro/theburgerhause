import type { Fulfillment } from "@/domain/order-status";

type Range = { low: number; high: number };

/**
 * The estimate minus the minutes this order has already spent in the kitchen queue. null when
 * nothing is left to wait ("en unos minutos"); never shows a range that starts at 0.
 */
export function remainingRange(range: Range, elapsedMinutes: number): Range | null {
  const elapsed = Math.max(0, Math.floor(elapsedMinutes));
  const high = range.high - elapsed;
  if (high <= 0) return null;
  return { low: Math.max(1, range.low - elapsed), high };
}

/** Whole minutes between `sinceIso` and `nowMs` (0 when the date is missing, invalid or in the future). */
export function elapsedMinutes(sinceIso: string | undefined, nowMs: number): number {
  if (!sinceIso) return 0;
  const since = Date.parse(sinceIso);
  if (Number.isNaN(since)) return 0;
  return Math.max(0, Math.floor((nowMs - since) / 60_000));
}

/** "Tu pedido" line of the order view. */
export function orderNoticeText(args: { range: Range; elapsedMinutes: number; fulfillment: Fulfillment | undefined; delayed: boolean }): string {
  const left = remainingRange(args.range, args.elapsedMinutes);
  const suffix = args.delayed ? " (hay más demora de lo normal)" : "";
  if (left === null) return `Tu pedido estará listo en unos minutos${suffix}`;
  const text = `${left.low}–${left.high} min`;
  return args.fulfillment === "delivery" ? `Tu pedido llega en aprox. ${text}${suffix}` : `Tu pedido estará listo en aprox. ${text}${suffix}`;
}
