"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import type { CajaOrder, FailedPrintJob } from "@/lib/orders/caja-queries";
import { FailedPrintAlert } from "./failed-print-alert";
import { PendingSection } from "./pending-section";
import { RecentSection } from "./recent-section";
import { SoundHintBanner, SoundToggle } from "./sound-controls";
import { useNewOrderAlert } from "./use-new-order-alert";
import { useNow } from "./use-now";

const DISMISS_AFTER_MS = 12_000;

type Props = {
  pending: CajaOrder[];
  recent: CajaOrder[];
  failed: FailedPrintJob[];
  /** ISO time of the server render: the clock starts here so hydration matches. */
  serverNow: string;
  hasStation: boolean;
};

function NoStation() {
  return (
    <div role="alert" data-testid="no-station" className="mx-auto max-w-lg rounded-2xl border-2 border-state-error bg-red-50 p-8 text-center">
      <h2 className="font-display text-2xl font-extrabold text-ink">Falta elegir la estación</h2>
      <p className="mt-2 text-lg text-ink-muted">Sin estación no sabemos en qué impresora imprimir los pedidos.</p>
      <Link
        href="/estacion?next=/caja"
        className="mt-5 inline-flex min-h-14 items-center rounded-full bg-brand-600 px-8 font-display text-lg font-bold text-white hover:bg-brand-700"
      >
        Elegir estación
      </Link>
    </div>
  );
}

/**
 * The Caja screen: live pending orders, the persistent failed-print alert and recent orders.
 * It does NOT open its own event stream: the staff shell's LiveRefresh re-renders the page.
 */
export function CajaBoard({ pending, recent, failed, serverNow, hasStation }: Props) {
  const now = useNow(serverNow);
  const alert = useNewOrderAlert(pending);
  // Orders another cashier handled first: kept on screen (frozen, with the reason) until dismissed.
  const [ghosts, setGhosts] = useState<ReadonlyMap<number, { order: CajaOrder; message: string }>>(new Map());

  const onConflict = useCallback((order: CajaOrder, message: string) => {
    setGhosts((g) => new Map(g).set(order.id, { order, message }));
    window.setTimeout(() => {
      setGhosts((g) => {
        const next = new Map(g);
        next.delete(order.id);
        return next;
      });
    }, DISMISS_AFTER_MS);
  }, []);
  const onDismiss = useCallback((orderId: number) => {
    setGhosts((g) => {
      const next = new Map(g);
      next.delete(orderId);
      return next;
    });
  }, []);

  const shown = useMemo(() => {
    const live = new Set(pending.map((o) => o.id));
    const extra = [...ghosts.values()].map((g) => g.order).filter((o) => !live.has(o.id));
    return [...pending, ...extra].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id);
  }, [pending, ghosts]);
  const resolved = useMemo(() => new Map([...ghosts].map(([id, g]) => [id, g.message])), [ghosts]);

  if (!hasStation) return <NoStation />;

  return (
    <div className="space-y-6">
      <FailedPrintAlert jobs={failed} />
      <SoundHintBanner hint={alert.hint} onEnable={alert.toggleSound} />
      <PendingSection
        orders={shown}
        pendingCount={pending.length}
        now={now}
        freshIds={alert.freshIds}
        resolved={resolved}
        onConflict={onConflict}
        onDismiss={onDismiss}
        toolbar={<SoundToggle on={alert.soundOn} onToggle={alert.toggleSound} />}
      />
      <RecentSection orders={recent} now={now} />
      <p aria-live="polite" role="status" data-testid="caja-announcer" className="sr-only">
        {alert.announcement}
      </p>
    </div>
  );
}
