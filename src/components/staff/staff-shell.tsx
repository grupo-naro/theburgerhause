import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { getDb } from "@/db/client";
import { LiveRefresh } from "@/components/live/live-refresh";
import { LogoutButton } from "@/components/logout-button";
import { isManager, type AuthSession } from "@/lib/auth/roles";
import { navLinksFor } from "@/lib/caja/nav";
import { listPendingApproval } from "@/lib/orders/caja-queries";
import { derivePrinterStatus } from "@/lib/caja/printer-status";
import { getStationHeader } from "@/lib/stations/header";
import { DelayPanel } from "./delay-panel";
import { getDelayPanelData } from "./delay-panel-data";
import { PrinterHeartbeatRefresh } from "./printer-heartbeat-refresh";
import { PrinterIndicator } from "./printer-indicator";
import { ShellOrderAlert } from "./shell-order-alert";
import { StaffNav } from "./staff-nav";
import { StockAlert } from "./stock-alert";
import { loadShortages } from "./stock-alert-data";

/** The chip is a convenience: if its data fails, the shell renders without it. */
async function loadDelayChip() {
  try {
    return await getDelayPanelData(getDb(), new Date());
  } catch {
    console.error("staff-shell: delay chip unavailable");
    return null;
  }
}

/**
 * Common frame of the staff screens: role navigation, top bar (station, printer, live connection,
 * user, logout) and the page. It owns the page's ONE live connection (`LiveRefresh`): screens
 * inside it must not mount another. Reads request data: render it inside <Suspense>.
 */
export async function StaffShell({ session, ownsOrderAlert = false, children }: { session: AuthSession; ownsOrderAlert?: boolean; children: ReactNode }) {
  const station = session.stationId === null ? null : await getStationHeader(getDb(), session.stationId, isManager(session.user.role) ? null : session.stationKind);
  const printer = station
    ? derivePrinterStatus({ lastSeenAt: station.lastSeenAt, failedCount: station.failedCount, now: new Date() })
    : null;

  // New web orders of the sector wait for approval on the workspace page; everywhere else the shell announces them
  // (nav badge always, beep/title only when the page has no alert of its own: never two beeps).
  const ownSector = session.user.role === "cajera" ? "mostrador" : session.user.role === "encargada_delivery" ? "delivery" : null;
  const sector = ownSector !== null && session.stationKind === ownSector ? ownSector : null;
  // The delay panel is for the STAFF3 roles; cocina (the TV login) never sees it.
  const [waiting, delay, shortages] = await Promise.all([
    sector === null ? Promise.resolve([]) : listPendingApproval(getDb(), { sector, channel: "web" }),
    session.user.role === "cocina" ? Promise.resolve(null) : loadDelayChip(),
    loadShortages(),
  ]);
  const badges = sector === null || waiting.length === 0 ? {} : { [sector === "mostrador" ? "/retiro" : "/delivery"]: waiting.length };

  return (
    <div className="group/shell min-h-dvh lg:grid lg:grid-cols-[14rem_1fr] lg:grid-rows-[auto_1fr]">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface px-4 py-3 sm:px-6 lg:col-start-2 lg:row-start-1">
        <Image src="/brand/logo-512.webp" alt="" width={36} height={36} className="size-9 rounded-full lg:hidden" />
        <div className="flex-1">
          <p data-testid="station-name" className="font-display text-xl leading-tight font-extrabold whitespace-nowrap text-brand-600 sm:text-2xl">
            {station ? `Estación: ${station.name}` : "Sin estación"}
          </p>
          <Link href="/estacion" className="text-sm font-semibold text-ink-muted underline underline-offset-4 hover:text-brand-600">
            {station ? "Cambiar estación" : "Elegir estación"}
          </Link>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2">
          {sector !== null && !ownsOrderAlert && <ShellOrderAlert orders={waiting.map((o) => ({ id: o.id, number: o.number, createdAt: o.createdAt }))} />}
          {delay && <DelayPanel data={delay} />}
          {printer && <PrinterIndicator status={printer} />}
          <LiveRefresh large />
          <PrinterHeartbeatRefresh />
          <span data-testid="user-name" className="hidden text-base font-semibold text-ink 2xl:inline">
            {session.user.name}
          </span>
          <LogoutButton />
        </div>
      </header>
      <StaffNav links={navLinksFor(session.user.role, session.stationKind)} badges={badges} />
      <main className="min-w-0 px-4 py-6 sm:px-6 lg:col-start-2 lg:row-start-2">
        <StockAlert initial={shortages} />
        {children}
      </main>
    </div>
  );
}

/** Suspense fallback with the same box as the shell, so nothing jumps when it resolves. */
export function StaffShellFallback() {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[14rem_1fr] lg:grid-rows-[auto_1fr]" aria-busy="true">
      <div className="h-[4.5rem] border-b border-line bg-surface lg:col-start-2" />
      <div className="h-16 bg-ink lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:h-dvh" />
      <p className="p-6 text-ink-muted lg:col-start-2">Cargando…</p>
    </div>
  );
}
