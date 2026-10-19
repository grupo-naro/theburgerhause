import type { Fulfillment } from "@/domain/order-status";
import { isManager, type Role } from "@/lib/auth/roles";

/**
 * Sector rule (Task 10.1): web orders are distributed BY ORDER TYPE. Delivery orders belong to the
 * delivery sector (Delivery-kind stations); takeaway orders and counter sales belong to the counter
 * (mostrador) sector (Mostrador-kind stations). Pure: no db, no next/*. The queries filter by it and
 * every order-level action rejects the wrong sector with WRONG_SECTOR before any write. Admin and encargado are exempt.
 */

export type Sector = "mostrador" | "delivery";
export type StationKindName = "mostrador" | "delivery";

export const WRONG_SECTOR_MESSAGE = "Este pedido es de otro sector: lo gestiona la otra estación.";

export function sectorOfFulfillment(fulfillment: Fulfillment): Sector {
  return fulfillment === "delivery" ? "delivery" : "mostrador";
}

/** Counter sales are always takeaway, so the fulfillment alone decides. */
export function sectorOfOrder(order: { fulfillment: Fulfillment }): Sector {
  return sectorOfFulfillment(order.fulfillment);
}

export type ActorSector = { ok: true; sector: Sector | null } | { ok: false; code: "STATION_REQUIRED" | "WRONG_SECTOR" };

/** The sector a user acts in: admin and encargado are exempt (null); staff act in their station's kind; no station -> cannot act. */
export function actorSectorFor(role: Role, stationKind: StationKindName | null): ActorSector {
  if (isManager(role)) return { ok: true, sector: null };
  if (stationKind === null) return { ok: false, code: "STATION_REQUIRED" };
  if (!stationAllowedForRole(role, stationKind)) return { ok: false, code: "WRONG_SECTOR" };
  return { ok: true, sector: stationKind };
}

/**
 * The sector a user acts in on the KITCHEN SCREEN (ready / undo-ready ONLY). The `cocina` role cooks every
 * sector's orders, so it is exempt (null) and needs no station; everyone else keeps the normal rule.
 * No other action may use this: `actorSectorFor` still refuses `cocina` everywhere else.
 */
export function kitchenActorSectorFor(role: Role, stationKind: StationKindName | null): ActorSector {
  return role === "cocina" ? { ok: true, sector: null } : actorSectorFor(role, stationKind);
}

/** The Spanish refusal an action returns for a failed `actorSectorFor`. */
export function actorRefusal(code: "STATION_REQUIRED" | "WRONG_SECTOR"): { ok: false; code: typeof code; message: string } {
  return { ok: false, code, message: code === "WRONG_SECTOR" ? WRONG_SECTOR_MESSAGE : "Elegí tu estación para trabajar" };
}

/** `actor` null/undefined = unrestricted (admin). */
export function isWrongSector(actor: Sector | null | undefined, fulfillment: Fulfillment): boolean {
  return actor != null && actor !== sectorOfFulfillment(fulfillment);
}

export type SectorDecision = { ok: true } | { ok: false; code: "WRONG_SECTOR"; message: string };

export function decideSector(actor: Sector | null | undefined, fulfillment: Fulfillment): SectorDecision {
  return isWrongSector(actor, fulfillment) ? { ok: false, code: "WRONG_SECTOR", message: WRONG_SECTOR_MESSAGE } : { ok: true };
}

/** Supported role/station combinations: staff work at the station kind of their own sector (admin anywhere). */
export function stationAllowedForRole(role: Role, kind: StationKindName): boolean {
  if (isManager(role)) return true;
  if (role === "cocina") return false; // the kitchen has no station: it only uses the kitchen screen
  return role === "cajera" ? kind === "mostrador" : kind === "delivery";
}
