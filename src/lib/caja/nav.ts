import type { Role } from "@/lib/auth/roles";

export type NavLink = { href: string; label: string };

const CAJA: NavLink = { href: "/caja", label: "Caja" };
const MOSTRADOR: NavLink = { href: "/mostrador", label: "Mostrador" };
const DESPACHO: NavLink = { href: "/despacho", label: "Despacho" };
const RENDICION: NavLink = { href: "/despacho/rendicion", label: "Rendición" };
const ADMIN: NavLink = { href: "/admin", label: "Administración" };

const BY_ROLE: Record<Role, readonly NavLink[]> = {
  cajera: [CAJA, MOSTRADOR, DESPACHO],
  encargada_delivery: [DESPACHO, RENDICION, CAJA],
  admin: [CAJA, MOSTRADOR, DESPACHO, RENDICION, ADMIN],
};

/** The link of the section being viewed: the most specific prefix match ("/despacho/rendicion" is not "/despacho"). */
export function activeNavHref(pathname: string, links: readonly NavLink[]): string | null {
  let best: string | null = null;
  for (const l of links) {
    if ((pathname === l.href || pathname.startsWith(`${l.href}/`)) && (best === null || l.href.length > best.length)) best = l.href;
  }
  return best;
}

/** Staff side navigation: only the screens a role may open (the pages still guard themselves). */
export function navLinksForRole(role: Role): NavLink[] {
  return [...BY_ROLE[role]];
}
