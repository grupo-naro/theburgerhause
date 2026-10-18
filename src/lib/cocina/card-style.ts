import type { Sector } from "@/lib/orders/sector";
import type { KitchenCard, KitchenType } from "@/lib/orders/kitchen-queries";

/** Pure helpers of the kitchen screen (no react, no db): tag style, who may act on a card, the clock. */

export const KITCHEN_TYPE_LABEL: Record<KitchenType, string> = { delivery: "DELIVERY", mostrador: "MOSTRADOR", retiro: "RETIRO" };
/** Delivery orange, counter blue (owner's design); takeaway a teal that is neither. */
export const KITCHEN_TYPE_COLOR: Record<KitchenType, string> = { delivery: "#e0612b", mostrador: "#3b6fd1", retiro: "#0f8a7a" };

export function sectorOfKitchenType(type: KitchenType): Sector {
  return type === "delivery" ? "delivery" : "mostrador";
}

/** `actor` null = exempt (cocina, admin). Mirrors the server rule so the UI does not offer a button that would be refused. */
export function canActOn(actor: Sector | null, type: KitchenType): boolean {
  return actor === null || actor === sectorOfKitchenType(type);
}

/** Whole minutes since `sinceIso`, floored, never negative; 0 for an unreadable date. */
export function ageMinutes(sinceIso: string, nowMs: number): number {
  const t = Date.parse(sinceIso);
  return Number.isFinite(t) ? Math.max(0, Math.floor((nowMs - t) / 60_000)) : 0;
}

/** A kitchen card as it crosses the server -> client boundary (dates as ISO strings). */
export type KitchenCardDto = Omit<KitchenCard, "since"> & { since: string };

export const toKitchenCardDto = (c: KitchenCard): KitchenCardDto => ({ ...c, since: c.since.toISOString() });
