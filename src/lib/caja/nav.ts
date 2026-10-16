import type { Role } from "@/lib/auth/roles";

export type NavLink = { href: string; label: string };

const CAJA: NavLink = { href: "/caja", label: "Caja" };
const MOSTRADOR: NavLink = { href: "/mostrador", label: "Mostrador" };
const DESPACHO: NavLink = { href: "/despacho", label: "Despacho" };
const ADMIN: NavLink = { href: "/admin", label: "Administración" };

const BY_ROLE: Record<Role, readonly NavLink[]> = {
  cajera: [CAJA, MOSTRADOR, DESPACHO],
  encargada_delivery: [DESPACHO, CAJA],
  admin: [CAJA, MOSTRADOR, DESPACHO, ADMIN],
};

/** Staff side navigation: only the screens a role may open (the pages still guard themselves). */
export function navLinksForRole(role: Role): NavLink[] {
  return [...BY_ROLE[role]];
}
