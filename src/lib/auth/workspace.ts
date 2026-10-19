import { redirect } from "next/navigation";
import { requireSessionOrRedirect } from "@/lib/auth/guards";
import { isManager, type AuthSession, type Role } from "@/lib/auth/roles";
import { legacyRedirectTarget } from "@/lib/caja/workspaces";
import type { Sector } from "@/lib/orders/sector";

/** Why /estacion was opened: lets it explain the redirect. */
export const WRONG_STATION_REASON = "sector";

function stationUrl(next: string, reason?: string): string {
  const q = new URLSearchParams({ next });
  if (reason) q.set("motivo", reason);
  return `/estacion?${q.toString()}`;
}

/**
 * Guard of a sector workspace page (the real check; the nav only hides links). Staff must sit at a
 * station of the workspace's kind: no station -> pick one; the wrong kind (a cashier at a Delivery
 * station, ...) -> pick another, with an explanation. Admin enters every workspace (scope = the
 * workspace's sector, so they see that sector's orders) with or without a station.
 */
export async function requireWorkspace(
  sector: Sector,
  roles: Role[],
  path: string,
): Promise<{ session: AuthSession; scope: Sector }> {
  const session = await requireSessionOrRedirect(roles, path);
  if (isManager(session.user.role)) return { session, scope: sector };
  if (session.stationId === null) redirect(stationUrl(path));
  if (session.stationKind !== sector) redirect(stationUrl(path, WRONG_STATION_REASON));
  return { session, scope: sector };
}

/**
 * Guard of the old general URLs (/caja, /despacho): admin keeps them as read-all views, staff are
 * sent to their sector workspace.
 */
export async function requireGeneralView(legacy: "caja" | "despacho", path: string): Promise<AuthSession> {
  const session = await requireSessionOrRedirect(["cajera", "encargada_delivery", "admin", "encargado"], path);
  const target = legacyRedirectTarget(legacy, session.user.role);
  if (target) redirect(target);
  return session;
}
