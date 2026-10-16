import type { Role } from "@/lib/auth/roles";
import type { Sector } from "@/lib/orders/sector";

/** One workspace per sector (Task 10.1): tabs of the order workspaces (/retiro and /delivery) and the old-URL redirects. */

export type TabId = "pending" | "preparing" | "ready" | "enroute" | "recent";
export type LaneId = "preparing" | "ready" | "pickup" | "enroute";
export type Tab = { id: TabId; label: string };

const PENDING: Tab = { id: "pending", label: "Por aprobar" };
const PREPARING: Tab = { id: "preparing", label: "En preparación" };
const RECENT: Tab = { id: "recent", label: "Recientes" };

const TABS: Record<Sector, readonly Tab[]> = {
  delivery: [PENDING, PREPARING, { id: "ready", label: "Listos / Despacho" }, { id: "enroute", label: "En camino" }, RECENT],
  mostrador: [PENDING, PREPARING, { id: "ready", label: "Listos / Para retirar" }, RECENT],
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
export function tabLanes(tab: TabId, sector: Sector = "delivery"): LaneId[] {
  switch (tab) {
    case "preparing":
      return ["preparing"];
    case "ready":
      return sector === "mostrador" ? ["ready", "pickup"] : ["ready"];
    case "enroute":
      return ["enroute"];
    default:
      return [];
  }
}

/** Where the old general URLs send staff (null = admin keeps the general view). */
export function legacyRedirectTarget(legacy: "caja" | "despacho", role: Role): string | null {
  if (role === "admin") return null;
  if (role === "encargada_delivery") return "/delivery";
  return legacy === "caja" ? "/retiro" : "/mostrador/pedidos";
}
