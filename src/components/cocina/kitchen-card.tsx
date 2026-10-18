"use client";

import { useRouter } from "next/navigation";
import { kitchenReadyAction } from "@/app/(staff)/cocina/actions";
import { useCardAction } from "@/components/despacho/use-card-action";
import { useToast } from "@/components/ui/toast";
import { ageMinutes, KITCHEN_TYPE_COLOR, KITCHEN_TYPE_LABEL, type KitchenCardDto } from "@/lib/cocina/card-style";
import { ageColor, ageLabel, type AgeColor, type KitchenThresholds } from "@/lib/orders/kitchen-age";
import { runUndo } from "./undo";

export const UNDO_TOAST_MS = 8000;

const ACCENT: Record<AgeColor, string> = { green: "border-l-emerald-500", yellow: "border-l-amber-400", red: "border-l-red-500" };
const CLOCK: Record<AgeColor, string> = {
  green: "bg-emerald-600 text-white",
  yellow: "bg-amber-400 text-[#1a1200]",
  red: "bg-red-600 text-white",
};

export function TypeTag({ type }: { type: KitchenCardDto["type"] }) {
  return (
    <span
      data-testid="type-tag"
      data-type={type}
      style={{ backgroundColor: KITCHEN_TYPE_COLOR[type] }}
      className="inline-flex items-center rounded-lg px-3 py-1 text-xl font-extrabold tracking-wide text-white"
    >
      {KITCHEN_TYPE_LABEL[type]}
    </span>
  );
}

type Props = {
  card: KitchenCardDto;
  now: number;
  thresholds: KitchenThresholds;
  /** False when the server would refuse this user (another sector / no station): the button says so instead of failing. */
  canAct: boolean;
  fresh: boolean;
};

/**
 * One order in preparation (design A): big number, type tag, colour clock, units numbered with their modifier
 * labels, the customer note highlighted, and a full-width LISTO. Long orders scroll INSIDE the card (never clipped).
 * Everything the customer typed is rendered as React text: markup and emoji are inert.
 */
export function KitchenCard({ card, now, thresholds, canAct, fresh }: Props) {
  const router = useRouter();
  const toast = useToast();
  const { exec, busy, error } = useCardAction();
  const minutes = ageMinutes(card.since, now);
  const color = ageColor(minutes, thresholds);

  const markReady = () =>
    exec(
      () => kitchenReadyAction({ orderId: card.id }),
      () =>
        toast.show({
          message: `Pedido #${card.number} listo`,
          durationMs: UNDO_TOAST_MS,
          action: { label: "Deshacer", large: true, onClick: () => void runUndo(card.id, { router, toast }) },
        }),
      (f) => toast.show({ message: f.message, durationMs: 6000 }),
    );

  return (
    <article
      data-testid="kitchen-card"
      data-order-number={card.number}
      data-type={card.type}
      data-age={color}
      data-leaving={busy ? "true" : undefined}
      className={`flex max-h-[max(26rem,calc(100dvh-22rem))] min-h-0 flex-col rounded-2xl border-2 border-l-[14px] border-white/15 bg-[#121c33] p-4 transition-opacity ${ACCENT[color]} ${busy ? "opacity-60" : ""} ${fresh ? "animate-card-flash" : ""}`}
    >
      <header className="flex items-start justify-between gap-3">
        <h2 className="font-display text-5xl leading-none font-extrabold text-white">
          <span className="text-white/60">#</span>
          {card.number}
        </h2>
        <time
          dateTime={card.since}
          data-testid="kitchen-clock"
          data-color={color}
          className={`rounded-full px-4 py-1.5 text-xl font-extrabold whitespace-nowrap tabular-nums ${CLOCK[color]}`}
        >
          {ageLabel(minutes)}
        </time>
      </header>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <TypeTag type={card.type} />
        {card.pager !== null && (
          <span data-testid="kitchen-pager" className="inline-flex items-center rounded-lg bg-white px-3 py-1 text-xl font-extrabold text-[#0b1220]">
            LLAMADOR {card.pager}
          </span>
        )}
      </div>

      <div
        tabIndex={0}
        role="region"
        aria-label={`Productos del pedido ${card.number}`}
        data-testid="kitchen-units"
        className="relative mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1 focus-visible:outline-cheddar-400"
      >
        {card.note !== null && (
          <p
            data-testid="kitchen-note"
            className="mb-3 rounded-lg bg-cheddar-400 px-3 py-2 text-xl leading-snug font-extrabold [overflow-wrap:anywhere] whitespace-pre-line text-ink"
          >
            NOTA: {card.note}
          </p>
        )}
        <ol className="space-y-3">
          {card.units.map((u) => (
            <li key={u.n} data-testid="kitchen-unit" className="flex gap-3">
              <span aria-hidden="true" className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-white/15 text-xl font-extrabold text-white">
                {u.n}
              </span>
              <div className="min-w-0">
                <p className="text-2xl leading-tight font-extrabold [overflow-wrap:anywhere] text-white uppercase">
                  <span className="sr-only">Unidad {u.n}: </span>
                  {u.productName}
                </p>
                {u.lines.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {u.lines.map((l, i) => (
                      <li key={i} data-testid="kitchen-line" className="text-xl leading-snug font-bold [overflow-wrap:anywhere] text-cheddar-400">
                        {l}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>

      {error !== null && (
        <p role="alert" data-testid="kitchen-error" className="mt-3 rounded-lg bg-red-950 px-3 py-2 text-lg font-bold text-red-100">
          {error}
        </p>
      )}
      <button
        type="button"
        data-testid="kitchen-ready"
        disabled={busy || !canAct}
        onClick={markReady}
        className="mt-3 min-h-16 w-full rounded-xl bg-emerald-600 px-4 font-display text-3xl font-extrabold tracking-wide text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-600 disabled:text-white/80"
      >
        {!canAct ? "OTRO SECTOR" : busy ? "MARCANDO…" : "LISTO"}
      </button>
    </article>
  );
}
