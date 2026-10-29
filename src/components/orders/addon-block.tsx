"use client";

import { useState } from "react";
import { cancelAddonAction, confirmAddonAction } from "@/app/(staff)/editar-pedido/actions";
import { useGuardedAction } from "@/components/caja/use-guarded-action";
import { formatARS } from "@/domain/money";
import type { DispatchAddon } from "@/lib/orders/dispatch-queries";

type Props = {
  orderId: number;
  addons: DispatchAddon[];
  /** Called after a confirm / cancel went through (the board refreshes). */
  onChanged: () => void;
};

function AddonItems({ items }: { items: DispatchAddon["items"] }) {
  return (
    <ul className="space-y-0.5 text-base">
      {items.map((it, i) => (
        <li key={i}>
          <span className="font-semibold">{it.name}</span>
          {it.modifiers.map((m, j) => (
            <span key={j} className="ml-1.5 inline-block rounded bg-cheddar-400/40 px-1.5 text-xs font-extrabold tracking-wide uppercase">
              {m}
            </span>
          ))}
          {it.note && <span className="ml-1.5 text-sm font-semibold text-ink-muted">· Nota: {it.note}</span>}
        </li>
      ))}
    </ul>
  );
}

function PendingAddon({ addon, onChanged }: { addon: DispatchAddon; onChanged: () => void }) {
  const { run, pending, error } = useGuardedAction();
  const [verified, setVerified] = useState(false);
  return (
    <li data-testid="addon-pending" data-addon-seq={addon.seq} className="space-y-3 rounded-xl border-2 border-cheddar-600 bg-cheddar-400/15 p-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-display text-lg font-extrabold uppercase">Adicional {addon.seq} · sin pagar</p>
        <p data-testid="addon-subtotal" className="font-display text-xl font-extrabold tabular-nums">
          {formatARS(addon.subtotal)}
        </p>
      </div>
      <AddonItems items={addon.items} />
      <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border-2 border-line bg-surface px-3 text-base font-semibold">
        <input
          type="checkbox"
          data-testid="addon-verify"
          checked={verified}
          disabled={pending}
          onChange={(e) => setVerified(e.target.checked)}
          className="size-6 shrink-0 accent-green-700"
        />
        Verifiqué la acreditación
      </label>
      {error && (
        <p role="alert" className="rounded-xl border border-state-error bg-red-50 px-3 py-2 text-sm font-medium text-state-error">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          data-testid="addon-confirm"
          disabled={!verified || pending}
          onClick={() => run(() => confirmAddonAction({ addonId: addon.id, paymentVerified: true }), { onOk: onChanged })}
          className="min-h-12 flex-1 rounded-full bg-green-700 px-5 font-display text-base font-bold text-white hover:bg-green-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
        >
          Confirmar adicional
        </button>
        <button
          type="button"
          data-testid="addon-cancel"
          disabled={pending}
          onClick={() => run(() => cancelAddonAction({ addonId: addon.id }), { onOk: onChanged })}
          className="min-h-12 rounded-full border-2 border-state-error bg-surface px-5 font-display text-base font-bold text-state-error hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Cancelar adicional
        </button>
      </div>
    </li>
  );
}

/** The add-ons of one preparing order: unpaid ones get verify / confirm / cancel; confirmed ones are informational. */
export function AddonBlock({ orderId, addons, onChanged }: Props) {
  if (addons.length === 0) return null;
  return (
    <ul aria-label="Adicionales" data-testid="addon-block" data-order-id={orderId} className="space-y-2">
      {addons.map((a) =>
        a.status === "pendiente_pago" ? (
          <PendingAddon key={a.id} addon={a} onChanged={onChanged} />
        ) : (
          <li key={a.id} data-testid="addon-confirmed" data-addon-seq={a.seq} className="rounded-xl bg-green-50 p-3">
            <p className="font-display text-base font-extrabold text-green-800 uppercase">
              Adicional {a.seq} <span className="tabular-nums">· {formatARS(a.subtotal)}</span>
            </p>
            <AddonItems items={a.items} />
          </li>
        ),
      )}
    </ul>
  );
}
