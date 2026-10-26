import { isManager, type Role } from "@/lib/auth/roles";
import type { Sector } from "@/lib/orders/sector";

/**
 * One workspace per sector (Task 10.1). Gestión Delivery (/delivery) is organised in tabs; Retiro en local
 * (/retiro) shows everything at once (few orders, the cashier wants to see them all), so it has no tabs.
 * Also the old-URL redirects.
 */

export type TabId = "pending" | "preparing" | "ready" | "enroute" | "recent";
export type LaneId = "preparing" | "ready" | "pickup" | "enroute";
export type Tab = { id: TabId; label: string };

const PENDING: Tab = { id: "pending", label: "Por aprobar" };
const PREPARING: Tab = { id: "preparing", label: "En preparación" };
const RECENT: Tab = { id: "recent", label: "Recientes" };

const TABS: Record<Sector, readonly Tab[]> = {
  delivery: [PENDING, PREPARING, { id: "ready", label: "Listos / Despacho" }, { id: "enroute", label: "En camino" }, RECENT],
  mostrador: [],
};

export function tabsFor(sector: Sector): Tab[] {
  return [...TABS[sector]];
}

/** `?tab=` -> a tab of the sector (anything else, including repeated params, is the first tab). */
export function parseTab(sector: Sector, raw: string | string[] | undefined): TabId {
  if (typeof raw !== "string") return "pending";
  return TABS[sector].find((t) => t.id === raw)?.id ?? "pending";
}

/** The dispatch lanes a tab shows (pending/recent show none: they are the cashier's part of the workspace). */
export function tabLanes(tab: TabId): LaneId[] {
  switch (tab) {
    case "preparing":
      return ["preparing"];
    case "ready":
      return ["ready"];
    case "enroute":
      return ["enroute"];
    default:
      return [];
  }
}

/** Where the old general URLs send staff (null = admin keeps the general view). */
export function legacyRedirectTarget(legacy: "caja" | "despacho", role: Role): string | null {
  if (isManager(role)) return null;
  if (role === "cocina") return "/pantalla";
  if (role === "encargada_delivery") return "/delivery";
  return legacy === "caja" ? "/retiro" : "/mostrador/pedidos";
}
