"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { assignCadetAction } from "@/app/(staff)/despacho/actions";
import { useGuardedAction } from "@/components/caja/use-guarded-action";
import { useNow } from "@/components/caja/use-now";
import { useToast } from "@/components/ui/toast";
import { formatARS } from "@/domain/money";
import type { Role } from "@/lib/auth/roles";
import type { LaneId } from "@/lib/caja/workspaces";
import { canAssign, failureHeadline, formatAssignFailure } from "@/lib/despacho/assign";
import { cashToCollect } from "@/lib/despacho/cash";
import { laneCounts } from "@/lib/despacho/lanes";
import { capabilitiesFor } from "@/lib/despacho/roles";
import { pruneSelection, selectionReducer } from "@/lib/despacho/selection";
import { buildDespachoTitle } from "@/lib/despacho/title";
import type { DispatchBoard as Board } from "@/lib/orders/dispatch-queries";
import type { Sector } from "@/lib/orders/sector";
import { AssignBar, type AssignFailure } from "./assign-bar";
import { CounterReadyCard } from "./counter-ready-card";
import { DeliveryReadyCard } from "./delivery-ready-card";
import { EnRouteCard } from "./en-route-card";
import { Lane } from "./lane";
import { LaneCounters } from "./lane-counters";
import { PickupCard } from "./pickup-card";
import { PreparingCard } from "./preparing-card";
import { useReadyAlert } from "./use-ready-alert";

type Props = {
  board: Board;
  role: Role;
  serverNow: string;
  /**
   * Sector workspace: which lanes exist (mostrador: preparing, ready, pickup; delivery: preparing,
   * ready, en camino). Null/absent = every lane (admin general view).
   */
  sector?: Sector | null;
  /**
   * Lanes to show right now (default: every lane of the sector). The board stays MOUNTED when the
   * list is empty so the selection, the ready alert and the title survive a tab change.
   */
  lanes?: readonly LaneId[];
  /** Header counters (default: only when no `lanes` filter is given). */
  showCounters?: boolean;
  /** Owns `document.title` (default true; a workspace that already owns it turns it off). */
  manageTitle?: boolean;
};

const SECTOR_LANES: Record<Sector, readonly LaneId[]> = {
  mostrador: ["preparing", "ready", "pickup"],
  delivery: ["preparing", "ready", "enroute"],
};
const ALL_LANES: readonly LaneId[] = ["preparing", "ready", "pickup", "enroute"];

const chip =
  "min-h-12 rounded-full border border-line bg-surface px-4 text-base font-bold text-ink hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50";

/**
 * The dispatch board (lanes of orders after approval). It does NOT open its own event stream: the
 * staff shell's LiveRefresh re-renders the page with a fresh `board`. Local state: the selection of
 * delivery orders, the chosen cadet and the last assignment failure.
 */
export function DispatchBoard({ board, role, serverNow, sector = null, lanes, showCounters, manageTitle = true }: Props) {
  const router = useRouter();
  const toast = useToast();
  const caps = capabilitiesFor(role);
  const now = useNow(serverNow);
  const counts = laneCounts(board);
  const { run, pending: assigning } = useGuardedAction();

  const [selection, dispatch] = useReducer(selectionReducer, new Set<number>());
  const [cadetPick, setCadetPick] = useState<number | null>(null);
  const [failure, setFailure] = useState<AssignFailure | null>(null);

  const readyDelivery = board.ready.delivery;
  const allReady = useMemo(() => [...readyDelivery, ...board.ready.takeaway], [readyDelivery, board.ready.takeaway]);
  const { freshIds, announcement } = useReadyAlert(allReady);

  // An order that left the delivery-ready lane (assigned by someone else, cancelled...) leaves the selection.
  const selectionRef = useRef(selection);
  useEffect(() => {
    selectionRef.current = selection;
  });
  useEffect(() => {
    dispatch({ type: "prune", keep: pruneSelection(selectionRef.current, board) });
  }, [board]);

  // A cadet deactivated meanwhile disappears from the selector and from the choice.
  const cadetId = board.cadets.some((c) => c.id === cadetPick) ? cadetPick : null;

  useEffect(() => {
    if (!manageTitle) return;
    const previous = document.title;
    document.title = buildDespachoTitle(counts.readyDelivery);
    return () => {
      document.title = previous;
    };
  }, [counts.readyDelivery, manageTitle]);

  const allowed = sector ? SECTOR_LANES[sector] : ALL_LANES;
  const visible = new Set(allowed.filter((l) => !lanes || lanes.includes(l)));
  const showDeliveryReady = visible.has("ready") && sector !== "mostrador";
  const showCounterReady = visible.has("ready") && sector !== "delivery";
  const mainCols = [visible.has("preparing"), visible.has("ready"), visible.has("pickup")].filter(Boolean).length;
  const wide = mainCols === 1;
  const grid3 = mainCols === 3;

  const selected = readyDelivery.filter((o) => selection.has(o.id));
  const phones = new Map(board.cadets.map((c) => [c.id, c.phone]));

  const assign = () => {
    if (cadetId === null || selected.length === 0) return;
    setFailure(null);
    run(() => assignCadetAction({ orderIds: selected.map((o) => o.id), cadetId }), {
      onOk: (data) => {
        const n = data.count;
        toast.show({
          message: `${n} ${n === 1 ? "pedido en camino" : "pedidos en camino"} con ${data.cadet.name} · Efectivo a rendir ${formatARS(data.cashToCollect)}`,
          durationMs: 6000,
        });
        dispatch({ type: "clear" });
        setCadetPick(null);
        router.refresh();
      },
      onFail: (f) => {
        const lines = formatAssignFailure(f.details);
        setFailure({ message: failureHeadline(f.message, lines.length > 0), lines });
        if (f.code === "CADET_INACTIVE" || f.code === "CADET_NOT_FOUND") setCadetPick(null);
        router.refresh(); // the pruning effect drops the orders that are no longer ready
      },
    });
  };

  const barOpen = caps.canAssign && showDeliveryReady && (selection.size > 0 || failure !== null);
  const ids = readyDelivery.map((o) => o.id);
  const allSelected = ids.length > 0 && ids.every((id) => selection.has(id));

  const deliveryReadyLane = (
    <Lane
      id="ready-delivery"
      title="Listos · Delivery"
      count={readyDelivery.length}
      tone="green"
      sub
      wide={wide}
      empty="Ningún pedido de delivery para despachar."
      actions={
        caps.canAssign && readyDelivery.length > 0 ? (
          <div className="flex gap-2">
            <button type="button" data-testid="select-all" className={chip} disabled={allSelected || assigning} onClick={() => dispatch({ type: "selectAll", ids })}>
              Seleccionar todos
            </button>
            <button type="button" data-testid="clear-selection" className={chip} disabled={selection.size === 0 || assigning} onClick={() => dispatch({ type: "clear" })}>
              Limpiar
            </button>
          </div>
        ) : null
      }
    >
      {readyDelivery.map((o) => (
        <DeliveryReadyCard
          key={o.id}
          order={o}
          now={now}
          fresh={freshIds.has(o.id)}
          canCancel={caps.canControlDelivery}
          selectable={caps.canAssign ? { selected: selection.has(o.id), onToggle: () => dispatch({ type: "toggle", id: o.id }) } : undefined}
        />
      ))}
    </Lane>
  );
  const counterReadyLane = (
    <Lane
      id="ready-counter"
      title="Listos · Mostrador / Retiro"
      count={counts.readyCounter}
      tone="green"
      sub
      wide={wide}
      empty="Ningún pedido de mostrador listo."
    >
      {board.ready.takeaway.map((o) => (
        <CounterReadyCard key={o.id} order={o} now={now} fresh={freshIds.has(o.id)} canControl={caps.canControlCounter} />
      ))}
    </Lane>
  );

  return (
    <div data-testid="dispatch-board" className={`space-y-5 ${barOpen ? "pb-44 md:pb-32" : ""}`}>
      {(showCounters ?? lanes === undefined) && <LaneCounters counts={counts} lanes={[...allowed]} />}
      {!caps.canAssign && sector === null && (
        <p data-testid="readonly-note" className="rounded-xl bg-brand-50 px-4 py-2.5 text-base font-medium text-ink">
          Podés ver todo el tablero y manejar los pedidos de mostrador. El delivery y los cadetes los gestiona la encargada.
        </p>
      )}

      {mainCols > 0 && (
        <div
          className={`grid items-start gap-4 ${
            grid3 ? "md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)]" : mainCols === 2 ? "md:grid-cols-2" : ""
          }`}
        >
          {visible.has("preparing") && (
            <Lane
              id="preparing"
              title="En preparación"
              count={counts.preparing}
              tone="blue"
              wide={wide}
              empty="Nada en la cocina ahora."
              className={grid3 ? "order-3 xl:order-1" : ""}
            >
              {board.preparing.map((o) => (
                <PreparingCard key={o.id} order={o} now={now} canMark={o.fulfillment === "delivery" ? caps.canControlDelivery : caps.canControlCounter} />
              ))}
            </Lane>
          )}

          {visible.has("ready") && (
            <section
              id="lane-ready"
              aria-labelledby="lane-ready-h"
              data-testid="lane-ready"
              className={`min-w-0 scroll-mt-4 ${grid3 ? "order-1 md:col-span-2 xl:order-2 xl:col-span-1" : ""}`}
            >
              <h2 id="lane-ready-h" tabIndex={-1} className="sr-only outline-none">
                Listos para despachar
              </h2>
              {showDeliveryReady && showCounterReady ? (
                <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-1">
                  {deliveryReadyLane}
                  {counterReadyLane}
                </div>
              ) : showDeliveryReady ? (
                deliveryReadyLane
              ) : (
                counterReadyLane
              )}
            </section>
          )}

          {visible.has("pickup") && (
            <Lane
              id="pickup"
              title="Para retirar"
              count={counts.pickup}
              tone="violet"
              wide={wide}
              empty="Nadie esperando en el mostrador."
              className={grid3 ? "order-2 xl:order-3" : ""}
            >
              {board.pickup.map((o) => (
                <PickupCard key={o.id} order={o} now={now} canControl={caps.canControlCounter} />
              ))}
            </Lane>
          )}
        </div>
      )}

      {visible.has("enroute") && (
        <Lane id="enroute" title="En camino" count={board.enRoute.length} tone="violet" empty="No hay cadetes en la calle.">
          <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
            {board.enRoute.map((g) => (
              <EnRouteCard key={g.cadet.id} group={g} phone={phones.get(g.cadet.id) ?? null} now={now} caps={caps} />
            ))}
          </div>
        </Lane>
      )}

      {barOpen && (
        <AssignBar
          count={selected.length}
          cash={cashToCollect(selected)}
          cadets={board.cadets}
          cadetId={cadetId}
          inFlight={assigning}
          failure={failure}
          state={canAssign(new Set(selected.map((o) => o.id)), cadetId, assigning)}
          onCadet={setCadetPick}
          onClear={() => dispatch({ type: "clear" })}
          onAssign={assign}
          onDismissFailure={() => setFailure(null)}
        />
      )}
      <p aria-live="polite" role="status" data-testid="despacho-announcer" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
