"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { reprintOrderAction } from "@/app/(staff)/caja/actions";
import type { FailedPrintJob } from "@/lib/orders/caja-queries";
import { useGuardedAction } from "./use-guarded-action";

type Which = "kitchen" | "ticket" | "both";
type Row = { orderId: number; orderNumber: number; which: Which; jobs: FailedPrintJob[] };

const TYPE_LABEL = { kitchen: "Cocina", ticket: "Ticket" } as const;

/** One row per order: both types failed -> reprint "both", otherwise just the failed one. */
function groupByOrder(jobs: FailedPrintJob[]): Row[] {
  const byOrder = new Map<number, FailedPrintJob[]>();
  for (const j of jobs) byOrder.set(j.orderId, [...(byOrder.get(j.orderId) ?? []), j]);
  return [...byOrder.values()].map((list) => {
    const types = new Set(list.map((j) => j.type));
    const which: Which = types.size > 1 ? "both" : list[0].type;
    return { orderId: list[0].orderId, orderNumber: list[0].orderNumber, which, jobs: list };
  });
}

function FailedRow({ row }: { row: Row }) {
  const router = useRouter();
  const { run, pending, error } = useGuardedAction();
  const [queued, setQueued] = useState(false);
  return (
    <li data-testid="failed-print" className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white/10 px-4 py-3">
      <div className="min-w-0">
        <p className="text-lg font-bold">
          Pedido #{row.orderNumber} ·{" "}
          {[...new Set(row.jobs.map((j) => TYPE_LABEL[j.type]))].join(" y ")}
        </p>
        {row.jobs.map((j) => (
          <p key={j.jobId} className="text-sm text-red-100">
            {TYPE_LABEL[j.type]}: {j.error ?? "Error desconocido"} · {j.attempts} {j.attempts === 1 ? "intento" : "intentos"}
          </p>
        ))}
        {error && (
          <p role="alert" className="mt-1 text-sm font-semibold text-white underline">
            {error}
          </p>
        )}
      </div>
      <button
        type="button"
        disabled={pending || queued}
        aria-label={`Reimprimir pedido #${row.orderNumber}`}
        onClick={() =>
          run(() => reprintOrderAction({ orderId: row.orderId, which: row.which }), {
            lockOnSuccess: true,
            onOk: () => {
              setQueued(true);
              router.refresh();
            },
          })
        }
        className="min-h-12 shrink-0 rounded-full bg-white px-6 font-display text-lg font-bold text-state-error transition-colors hover:bg-red-50 disabled:cursor-wait disabled:opacity-70"
      >
        {queued ? "Enviado" : pending ? "Enviando…" : "Reimprimir"}
      </button>
    </li>
  );
}

/** Persistent red banner: it only goes away when the failures are handled (a reprint supersedes them). */
export function FailedPrintAlert({ jobs }: { jobs: FailedPrintJob[] }) {
  if (jobs.length === 0) return null;
  const n = jobs.length;
  return (
    <section
      role="alert"
      aria-labelledby="failed-print-title"
      data-testid="failed-print-alert"
      className="rounded-2xl border-2 border-red-900 bg-state-error p-5 text-white shadow-md"
    >
      <h2 id="failed-print-title" className="font-display text-2xl font-extrabold">
        {n === 1 ? "1 impresión falló" : `${n} impresiones fallaron`}
      </h2>
      <p className="mb-3 text-red-100">Revisá la impresora (papel, cable, encendido) y reimprimí.</p>
      <ul className="space-y-2">
        {groupByOrder(jobs).map((r) => (
          <FailedRow key={r.orderId} row={r} />
        ))}
      </ul>
    </section>
  );
}
