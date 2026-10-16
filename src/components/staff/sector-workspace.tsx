"use client";

import { useId, useState } from "react";
import { CajaBoard } from "@/components/caja/caja-board";
import { DispatchBoard } from "@/components/despacho/dispatch-board";
import type { Role } from "@/lib/auth/roles";
import { tabLanes, tabsFor, type TabId } from "@/lib/caja/workspaces";
import type { CajaOrder, FailedPrintJob } from "@/lib/orders/caja-queries";
import type { DispatchBoard as Board } from "@/lib/orders/dispatch-queries";
import type { Sector } from "@/lib/orders/sector";

type Props = {
  sector: Sector;
  role: Role;
  initialTab: TabId;
  pending: CajaOrder[];
  recent: CajaOrder[];
  failed: FailedPrintJob[];
  board: Board;
  serverNow: string;
  hasStation: boolean;
  /** Base of the browser tab title and the workspace path (for the station link). */
  title: string;
  path: string;
};

/** Orders waiting in each tab (what the badge shows). */
function tabCount(tab: TabId, sector: Sector, pending: CajaOrder[], board: Board): number | null {
  switch (tab) {
    case "pending":
      return pending.length;
    case "preparing":
      return board.preparing.length;
    case "ready":
      return sector === "delivery" ? board.ready.delivery.length : board.ready.takeaway.length + board.pickup.length;
    case "enroute":
      return board.enRoute.reduce((n, g) => n + g.orders.length, 0);
    default:
      return null;
  }
}

/**
 * One workspace per sector (Retiro en local / Gestión Delivery): the cashier's approval flow and the
 * dispatch lanes of ONE sector behind tabs. Both boards stay mounted so the new-order alert, the
 * ready alert, the assignment selection and the tab title survive a tab change. It opens no event
 * stream: the staff shell's LiveRefresh re-renders the page with fresh data.
 */
export function SectorWorkspace({ sector, role, initialTab, pending, recent, failed, board, serverNow, hasStation, title, path }: Props) {
  const [tab, setTab] = useState<TabId>(initialTab);
  const baseId = useId();
  const tabs = tabsFor(sector);

  const select = (id: TabId) => {
    setTab(id);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", id);
      window.history.replaceState(window.history.state, "", url);
    } catch {
      /* the URL is a convenience only */
    }
  };
  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = tabs[(index + delta + tabs.length) % tabs.length];
    select(next.id);
    document.getElementById(`${baseId}-tab-${next.id}`)?.focus();
  };

  return (
    <div className="space-y-5">
      <div role="tablist" aria-label={title} data-testid="workspace-tabs" className="flex gap-2 overflow-x-auto pb-1">
        {tabs.map((t, i) => {
          const active = t.id === tab;
          const n = tabCount(t.id, sector, pending, board);
          const hot = n !== null && n > 0 && (t.id === "pending" || (t.id === "ready" && sector === "delivery"));
          return (
            <button
              key={t.id}
              id={`${baseId}-tab-${t.id}`}
              type="button"
              role="tab"
              data-testid={`tab-${t.id}`}
              aria-selected={active}
              aria-controls={`${baseId}-panel`}
              tabIndex={active ? 0 : -1}
              onClick={() => select(t.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={`inline-flex min-h-12 shrink-0 items-center gap-2 rounded-full border-2 px-5 text-base font-bold whitespace-nowrap transition-colors ${
                active ? "border-ink bg-ink text-white" : "border-line bg-surface text-ink hover:bg-brand-50"
              }`}
            >
              {t.label}
              {n !== null && (
                <span
                  data-testid={`tab-${t.id}-count`}
                  className={`inline-flex min-w-7 items-center justify-center rounded-full px-2 text-sm tabular-nums ${
                    hot ? "bg-state-pending text-ink" : active ? "bg-white/20 text-white" : "bg-slate-100 text-ink-muted"
                  }`}
                >
                  {n}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div id={`${baseId}-panel`} role="tabpanel" aria-labelledby={`${baseId}-tab-${tab}`} data-testid="workspace-panel" data-tab={tab} className="space-y-6">
        <CajaBoard
          pending={pending}
          recent={recent}
          failed={failed}
          serverNow={serverNow}
          hasStation={hasStation}
          show={{ pending: tab === "pending", recent: tab === "recent" }}
          titleBase={title}
          stationNext={path}
        />
        <DispatchBoard board={board} role={role} serverNow={serverNow} sector={sector} lanes={tabLanes(tab, sector)} manageTitle={false} />
      </div>
    </div>
  );
}
