import type { Role } from "@/lib/auth/roles";
import type { StationKindName } from "@/lib/orders/sector";

export type NavLink = { href: string; label: string };

const VENTA: NavLink = { href: "/mostrador", label: "Venta" };
const MOSTRADOR: NavLink = { href: "/mostrador/pedidos", label: "Mostrador" };
const RETIRO: NavLink = { href: "/retiro", label: "Retiro en local" };
const DELIVERY: NavLink = { href: "/delivery", label: "Gestión Delivery" };
const RENDICION: NavLink = { href: "/delivery/rendicion", label: "Rendición" };
const GENERAL_CAJA: NavLink = { href: "/caja", label: "Vista general" };
const GENERAL_DESPACHO: NavLink = { href: "/despacho", label: "Tablero general" };
const ADMIN: NavLink = { href: "/admin", label: "Administración" };
const CHANGE_STATION: NavLink = { href: "/estacion", label: "Cambiar estación" };

const MOSTRADOR_WORKSPACE: readonly NavLink[] = [VENTA, MOSTRADOR, RETIRO];
const DELIVERY_WORKSPACE: readonly NavLink[] = [DELIVERY, RENDICION];

/** The link of the section being viewed: the most specific prefix match ("/delivery/rendicion" is not "/delivery"). */
export function activeNavHref(pathname: string, links: readonly NavLink[]): string | null {
  let best: string | null = null;
  for (const l of links) {
    if ((pathname === l.href || pathname.startsWith(`${l.href}/`)) && (best === null || l.href.length > best.length)) best = l.href;
  }
  return best;
}

/**
 * Staff side navigation: ONE WORKSPACE PER SECTOR. A cashier on a Mostrador station sees the counter
 * workspace, the delivery manager on a Delivery station sees Gestión Delivery; admin sees everything.
 * A role/kind mismatch is not a supported combination: only "Cambiar estación" is offered. The pages
 * still guard themselves (this is navigation, not authorization).
 */
export function navLinksFor(role: Role, stationKind: StationKindName | null): NavLink[] {
  if (role === "admin") return [...MOSTRADOR_WORKSPACE, ...DELIVERY_WORKSPACE, GENERAL_CAJA, GENERAL_DESPACHO, ADMIN];
  const own = role === "cajera" ? "mostrador" : "delivery";
  if (stationKind !== null && stationKind !== own) return [CHANGE_STATION];
  return [...(own === "mostrador" ? MOSTRADOR_WORKSPACE : DELIVERY_WORKSPACE)];
}
