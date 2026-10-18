"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/ui/toast";
import type { KitchenCardDto } from "@/lib/cocina/card-style";
import { TypeTag } from "./kitchen-card";
import { runUndo } from "./undo";

type Props = { cards: KitchenCardDto[]; canAct: (card: KitchenCardDto) => boolean };

/** "Recién listos": the last orders marked ready that nobody took yet, each with "Volver a preparación". */
export function RecentlyReady({ cards, canAct }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<ReadonlySet<number>>(new Set());

  const undo = async (card: KitchenCardDto) => {
    setBusy((b) => new Set([...b, card.id]));
    await runUndo(card.id, { router, toast });
    setBusy((b) => new Set([...b].filter((id) => id !== card.id)));
  };

  return (
    <section
      aria-label="Recién listos"
      data-testid="recently-ready"
      className="sticky bottom-2 z-10 mt-4 flex items-center gap-3 rounded-2xl border-2 border-white/20 bg-[#18233d] p-2 shadow-[0_-8px_24px_rgba(0,0,0,0.45)]"
    >
      <h2 className="w-24 shrink-0 pl-2 text-base leading-tight font-extrabold tracking-wide text-white/80 uppercase">Recién listos</h2>
      {cards.length === 0 ? (
        <p data-testid="recently-ready-empty" className="min-w-0 flex-1 py-2 text-lg text-white/70">
          Todavía no marcaste ningún pedido como listo.
        </p>
      ) : (
        <ul className="flex min-w-0 flex-1 gap-3 overflow-x-auto">
          {cards.map((c) => (
            <li key={c.id} data-testid="recent-item" data-order-number={c.number} className="flex shrink-0 items-center gap-3 rounded-xl bg-[#0b1220] py-1.5 pr-1.5 pl-4">
              <span className="font-display text-3xl font-extrabold text-white">
                <span className="text-white/60">#</span>
                {c.number}
              </span>
              <TypeTag type={c.type} />
              <button
                type="button"
                data-testid="recent-undo"
                disabled={busy.has(c.id) || !canAct(c)}
                onClick={() => void undo(c)}
                className="min-h-14 rounded-xl border-2 border-white/50 px-4 text-lg font-extrabold text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Volver a preparación
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
