"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { settleCadetAction } from "@/app/(staff)/delivery/rendicion/actions";
import { useGuardedAction } from "@/components/caja/use-guarded-action";
import { buildReceipt, mismatchMessage, pluralOrders } from "@/lib/rendicion/receipt";
import { formatMoney } from "@/lib/rendicion/shortage";
import type { CadetSettlementDetail, SettlementRecord } from "@/lib/settlements/queries";
import type { SettleData } from "@/lib/settlements/settle-cadet";
import { History } from "./history";
import { InRouteList } from "./in-route-list";
import { OwedOrdersTable } from "./owed-orders-table";
import { ReceiptView } from "./receipt";
import { SettlePanel } from "./settle-panel";

const ALREADY_SETTLED = "Este cadete ya fue rendido por otra persona. El saldo está en $0.";

type Props = {
  detail: CadetSettlementDetail;
  serverNow: string;
  settledByName: string;
  historyAll: boolean;
  historyHasMore: boolean;
};

type Done = { data: SettleData; note: string; at: string };

/** Everything of one cadet: hero amount, the orders, the "Recibí el efectivo" panel, history. */
export function CadetDetail({ detail, serverNow, settledByName, historyAll, historyHasMore }: Props) {
  const router = useRouter();
  const now = useMemo(() => new Date(serverNow), [serverNow]);
  const { run, pending, error } = useGuardedAction();
  const failure = useRef<{ expected: number; actual: number; orderCount: number } | null>(null);

  const [done, setDone] = useState<Done | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  // Bumping the epoch remounts the panel: the received input resets to the new expected amount.
  const [epoch, setEpoch] = useState(0);
  const [base, setBase] = useState(detail.owed);

  // The balance moved under the manager's feet (live refresh): say so and reset the form.
  if (base !== detail.owed) {
    setBase(detail.owed);
    if (!done && !pending) {
      setBanner(
        detail.owed === 0
          ? ALREADY_SETTLED
          : mismatchMessage({ expected: base, actual: detail.owed, orderCount: detail.orders.length }),
      );
      setEpoch((e) => e + 1);
    }
  }

  const expected = detail.owed;
  const cadetId = detail.cadet.id;

  const submit = ({ received, note }: { received: number; note: string }) => {
    failure.current = null;
    run(
      async () => {
        const r = await settleCadetAction({
          cadetId,
          expectedAmount: expected,
          receivedAmount: received,
          ...(note ? { note } : {}),
        });
        if (r.ok) return r;
        failure.current = r.details ?? null;
        return { ok: false as const, code: r.code, message: r.message };
      },
      {
        lockOnSuccess: true,
        onOk: (data) => {
          setBanner(null);
          setDone({ data, note, at: new Date().toISOString() });
          router.refresh();
        },
        onFail: (f) => {
          if (f.code === "AMOUNT_MISMATCH" && failure.current) {
            setBanner(mismatchMessage(failure.current));
          } else if (f.code === "NOTHING_TO_SETTLE") {
            setBanner(ALREADY_SETTLED);
          } else {
            return; // the message stays inline in the dialog, retryable
          }
          setEpoch((e) => e + 1);
          router.refresh();
        },
      },
    );
  };

  const history: SettlementRecord[] = detail.recentSettlements;
  const receiptSource = done
    ? (history.find((h) => h.id === done.data.settlementId) ?? {
        id: done.data.settlementId,
        cadetName: done.data.cadet.name,
        amount: done.data.amount,
        receivedAmount: done.data.receivedAmount,
        shortage: done.data.shortage,
        orderCount: done.data.orderCount,
        orders: done.data.orders,
        settledByName,
        note: done.note || null,
        createdAt: done.at,
      })
    : null;

  const owes = !done && expected > 0;
  return (
    <div data-testid="cadet-detail" data-cadet-id={cadetId} className="space-y-5">
      <Link href="/delivery/rendicion" data-testid="back-to-list" className="inline-flex min-h-12 items-center text-base font-bold text-brand-600 underline underline-offset-4">
        ← Todos los cadetes
      </Link>

      <header className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <h1 className="font-display text-4xl leading-tight font-extrabold">
          <span className="block text-base font-bold text-ink-muted">Rendición de</span>
          <span data-testid="cadet-name">{detail.cadet.name}</span>
        </h1>
        {!detail.cadet.active && <span data-testid="inactive-tag" className="rounded-full bg-slate-200 px-3 py-1 text-sm font-bold text-slate-700">Inactivo</span>}
        {detail.cadet.phone && (
          <a href={`tel:${detail.cadet.phone.replace(/[^\d+]/g, "")}`} className="inline-flex min-h-12 items-center text-lg font-semibold text-brand-600 underline underline-offset-4">
            {detail.cadet.phone}
          </a>
        )}
      </header>

      {banner && (
        <p role="alert" data-testid="mismatch-banner" className="rounded-2xl border-2 border-state-error bg-red-50 px-5 py-4 text-lg font-bold text-red-900">
          {banner}
        </p>
      )}

      <section
        aria-label="Monto a rendir"
        className={`rounded-3xl px-6 py-6 sm:px-8 ${owes ? "bg-ink text-white" : "border-2 border-green-600 bg-green-100 text-green-900"}`}
      >
        {owes ? (
          <>
            <p className="text-xl font-bold text-cheddar-400">A rendir</p>
            <p data-testid="owed-amount" data-cents={expected} className="font-display text-7xl leading-none font-extrabold tracking-tight tabular-nums sm:text-8xl">
              {formatMoney(expected)}
            </p>
            <p data-testid="owed-count" className="mt-3 text-xl font-semibold">
              {pluralOrders(detail.orders.length)} en efectivo entregados
            </p>
          </>
        ) : (
          <>
            <p className="text-xl font-bold">{done ? "Rendición registrada" : "Al día"}</p>
            <p data-testid="owed-amount" data-cents={0} className="font-display text-7xl leading-none font-extrabold tabular-nums sm:text-8xl">
              {formatMoney(0)}
            </p>
            <p className="mt-3 text-xl font-semibold">Saldo del cadete: $0</p>
          </>
        )}
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_25rem]">
        <aside className="space-y-4 lg:sticky lg:top-4 lg:order-2" aria-label="Rendición">
          {done && receiptSource ? (
            <div data-testid="receipt-panel" className="space-y-4">
              <ReceiptView receipt={buildReceipt(receiptSource)} balanceAfter={formatMoney(0)} />
              <div className="flex flex-col gap-3 print:hidden">
                <button
                  type="button"
                  data-testid="print-receipt"
                  onClick={() => window.print()}
                  className="min-h-14 rounded-full bg-brand-600 px-6 font-display text-lg font-bold text-white hover:bg-brand-700"
                >
                  Imprimir comprobante
                </button>
                <Link
                  href="/delivery/rendicion"
                  data-testid="back-after-settle"
                  className="flex min-h-14 items-center justify-center rounded-full border-2 border-ink px-6 font-display text-lg font-bold hover:bg-brand-50"
                >
                  Volver a rendiciones
                </Link>
              </div>
            </div>
          ) : expected > 0 ? (
            <SettlePanel
              key={epoch}
              cadetName={detail.cadet.name}
              expected={expected}
              orderCount={detail.orders.length}
              busy={pending}
              error={error}
              onSubmit={submit}
              onCancelConfirm={() => undefined}
            />
          ) : (
            <p data-testid="nothing-to-settle" className="rounded-2xl border-2 border-green-600 bg-green-50 px-5 py-6 text-lg font-bold text-green-900">
              No tiene efectivo pendiente de rendir.
            </p>
          )}
        </aside>

        <div className="min-w-0 space-y-6 lg:order-1">
          <section aria-labelledby="owed-h" className="space-y-3">
            <h2 id="owed-h" className="font-display text-xl font-extrabold">
              Pedidos en efectivo entregados
            </h2>
            <OwedOrdersTable orders={detail.orders} total={expected} now={now} />
          </section>
          <InRouteList orders={detail.inRoute} />
          <History records={history} now={now} cadetId={cadetId} showingAll={historyAll} hasMore={historyHasMore} />
        </div>
      </div>
    </div>
  );
}
