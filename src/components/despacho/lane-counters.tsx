"use client";

import type { LaneCounts } from "@/lib/despacho/lanes";

const ITEMS = [
  { key: "preparing", lane: "preparing", label: "En preparación", dot: "bg-state-preparing" },
  { key: "ready", lane: "ready", label: "Listos", dot: "bg-state-ready" },
  { key: "pickup", lane: "pickup", label: "Para retirar", dot: "bg-state-route" },
  { key: "enRoute", lane: "enroute", label: "En camino", dot: "bg-state-route" },
] as const;

/** Header counters: each is a button that jumps to (and focuses) its lane. */
export function LaneCounters({ counts }: { counts: LaneCounts }) {
  const jump = (lane: string) => {
    const section = document.getElementById(`lane-${lane}`);
    const heading = document.getElementById(`lane-${lane}-h`);
    section?.scrollIntoView({ behavior: "smooth", block: "start" });
    heading?.focus({ preventScroll: true });
  };
  return (
    <nav aria-label="Resumen del tablero" className="grid grid-cols-2 gap-2 md:grid-cols-4">
      {ITEMS.map((i) => {
        const n = counts[i.key];
        const hot = i.key === "ready" && counts.readyDelivery > 0;
        return (
          <button
            key={i.key}
            type="button"
            data-testid={`counter-${i.key}`}
            onClick={() => jump(i.lane)}
            className={`flex min-h-16 items-center justify-between gap-3 rounded-2xl border-2 px-4 py-2 text-left transition-colors ${
              hot ? "border-cheddar-600 bg-cheddar-400 text-ink hover:bg-cheddar-400/80" : "border-line bg-surface text-ink hover:bg-brand-50"
            }`}
          >
            <span className="flex items-center gap-2 text-base font-bold">
              <span aria-hidden="true" className={`size-3 rounded-full ${i.dot}`} />
              {i.label}
            </span>
            <span data-testid={`counter-${i.key}-n`} className="font-display text-4xl leading-none font-extrabold tabular-nums">
              {n}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
