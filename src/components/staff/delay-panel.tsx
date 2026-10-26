"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { activateDelayAction, deactivateDelayAction } from "@/app/(staff)/demora/actions";
import { ModalDialog } from "@/components/despacho/modal-dialog";
import type { Estimate } from "@/lib/delay/estimate";
import type { DelayPanelData } from "./delay-panel-data";

const MINUTES = [5, 10, 15, 20, 30, 45, 60] as const;
const MAX_REASON = 120;

const range = (e: Estimate) => `${e.low}–${e.high} min`;
const when = (iso: string) =>
  new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(iso));

/**
 * Header chip + dialog to announce (or clear) a manual delay. The reason is staff-only: it is shown here
 * and never reaches the public estimate. The delay channel refreshes every open shell after a change.
 */
export function DelayPanel({ data }: { data: DelayPanelData }) {
  const [open, setOpen] = useState(false);
  const [minutes, setMinutes] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const router = useRouter();
  const titleId = useId();
  const { active, auto } = data;

  const close = () => {
    setOpen(false);
    setError(null);
  };
  const canActivate = minutes !== null && reason.trim().length > 0 && !busy;

  const activate = () => {
    if (minutes === null || !canActivate) return;
    startTransition(async () => {
      setError(null);
      const r = await activateDelayAction({ extraMinutes: minutes, reason: reason.trim() });
      if (!r.ok) return setError(r.message);
      setMinutes(null);
      setReason("");
      setOpen(false);
      router.refresh();
    });
  };

  const deactivate = () =>
    startTransition(async () => {
      setError(null);
      const r = await deactivateDelayAction();
      if (!r.ok) return setError(r.message);
      setOpen(false);
      router.refresh();
    });

  return (
    <>
      <button
        type="button"
        data-testid="delay-chip"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className={`inline-flex min-h-12 items-center gap-2 rounded-full border px-4 text-base font-bold ${
          active ? "border-state-error bg-red-50 text-state-error" : "border-line bg-surface text-ink hover:bg-brand-50"
        }`}
      >
        <span className="text-ink-muted">Demora</span>
        <span>{active ? `+${active.extraMinutes} min` : "Sin demora"}</span>
      </button>

      {open && (
        <ModalDialog titleId={titleId} testId="delay-dialog" busy={busy} onCancel={close}>
          <div className="space-y-4 p-6">
            <h2 id={titleId} className="font-display text-2xl font-extrabold text-ink">
              Avisar una demora
            </h2>

            <p data-testid="delay-auto" className="rounded-xl bg-brand-50 px-4 py-3 text-base text-ink">
              Estimación automática ahora ({auto.inPreparation} en preparación): retiro <strong>{range(auto.takeaway)}</strong>, delivery{" "}
              <strong>{range(auto.delivery)}</strong>.
            </p>

            {active && (
              <div data-testid="delay-active" className="space-y-2 rounded-xl border border-state-error bg-red-50 px-4 py-3">
                <p className="text-base font-bold text-state-error">Demora activa: +{active.extraMinutes} min</p>
                <p className="text-base text-ink">Motivo (interno): {active.reason}</p>
                <p className="text-sm text-ink-muted">
                  La activó {active.startedByName} a las {when(active.startedAt)}.
                </p>
                <button
                  type="button"
                  data-testid="delay-deactivate"
                  disabled={busy}
                  onClick={deactivate}
                  className="min-h-12 w-full rounded-full border border-state-error bg-surface px-6 text-lg font-bold text-state-error hover:bg-red-50 disabled:opacity-60"
                >
                  {busy ? "Desactivando…" : "Desactivar demora"}
                </button>
              </div>
            )}

            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                activate();
              }}
            >
              <fieldset className="space-y-2">
                <legend className="text-sm font-bold text-ink">{active ? "Cambiar los minutos extra" : "Minutos extra"}</legend>
                <div className="flex flex-wrap gap-2">
                  {MINUTES.map((m) => (
                    <button
                      key={m}
                      type="button"
                      disabled={busy}
                      aria-pressed={minutes === m}
                      onClick={() => setMinutes(m)}
                      className={`min-h-12 min-w-14 rounded-full border px-4 text-base font-semibold disabled:opacity-60 ${
                        minutes === m ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-surface text-ink hover:bg-brand-50"
                      }`}
                    >
                      +{m}
                    </button>
                  ))}
                </div>
              </fieldset>

              <div>
                <label htmlFor={`${titleId}-reason`} className="text-sm font-bold text-ink">
                  Motivo (solo lo ve el personal)
                </label>
                <input
                  id={`${titleId}-reason`}
                  value={reason}
                  maxLength={MAX_REASON}
                  disabled={busy}
                  onChange={(e) => setReason(e.target.value)}
                  className="mt-1 block min-h-12 w-full rounded-xl border border-line bg-surface px-4 text-base text-ink focus-visible:outline-2 focus-visible:outline-brand-600"
                />
              </div>

              {error && (
                <p role="alert" className="rounded-xl border border-state-error bg-red-50 px-4 py-2 text-sm font-medium text-state-error">
                  {error}
                </p>
              )}

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  disabled={busy}
                  onClick={close}
                  className="min-h-12 rounded-full border border-line bg-surface px-6 text-lg font-bold text-ink hover:bg-brand-50 disabled:opacity-60"
                >
                  Cerrar
                </button>
                <button
                  type="submit"
                  data-testid="delay-activate"
                  disabled={!canActivate}
                  className="min-h-12 rounded-full bg-brand-600 px-6 text-lg font-bold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? "Activando…" : "Activar demora"}
                </button>
              </div>
            </form>
          </div>
        </ModalDialog>
      )}
    </>
  );
}
