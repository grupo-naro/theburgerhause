/**
 * The last-resort error page (global-error) of the unattended counter TV: nobody is there to press "Reintentar", so on
 * /pantalla it reloads the whole page every few seconds until the server answers again (pure decision helpers).
 */

export const TV_RELOAD_INTERVAL_MS = 15_000;

/** Only the TV screen reloads by itself; every other route keeps its manual button. */
export function isTvPath(pathname: string | null | undefined): boolean {
  return typeof pathname === "string" && (pathname === "/pantalla" || pathname.startsWith("/pantalla/"));
}

/** Reload on this tick? Only on the TV path and only while the browser is online (offline reloads just show a dino). */
export function shouldAutoReload(pathname: string | null | undefined, online: boolean): boolean {
  return isTvPath(pathname) && online;
}
