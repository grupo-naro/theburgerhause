"use client";

import { useEffect, useRef, useState } from "react";
import { LiveRefresh } from "@/components/live/live-refresh";
import { CELL_H_EM, fitNumbers } from "@/lib/pantalla/fit";
import { useReadyChime } from "./use-ready-chime";
import { useSafetyRefresh } from "./use-safety-refresh";

export type BoardNumber = { id: number; number: number };

type Props = { preparing: BoardNumber[]; ready: BoardNumber[] };

/**
 * The counter TV (layout B): "En preparación" on the left third, "¡Listo! Retiralo en el mostrador" on the right two
 * thirds, highlighted and with bigger numbers. Read only: order numbers and the two titles, nothing else (no names,
 * addresses, amounts, pagers, menus or links). The only control is a discreet sound switch.
 *
 * It owns the page's ONE live connection (LiveRefresh) plus a 60 s safety refresh; every refresh re-renders the
 * server component with fresh lists. Numbers shrink to fit; if even the smallest size does not fit, the zone scrolls
 * itself gently (never a manual scrollbar).
 */
export function CounterBoard({ preparing, ready }: Props) {
  useSafetyRefresh();
  const chime = useReadyChime(
    preparing.map((o) => o.id),
    ready.map((o) => o.id),
  );

  return (
    <div data-testid="counter-board" data-tv-board="" className="fixed inset-0 grid grid-cols-[1fr_2fr] grid-rows-[minmax(0,1fr)_auto] overflow-hidden bg-[#0b1220] text-white">
      <h1 className="sr-only">Pedidos del mostrador</h1>
      <section
        data-testid="zone-preparing"
        aria-labelledby="zone-preparing-title"
        className="flex min-h-0 min-w-0 flex-col border-r-4 border-white/15 px-[1.5vw] pt-[2vh]"
      >
        <h2 id="zone-preparing-title" className="font-display text-[4.2vh] leading-tight font-extrabold text-white/90">
          En preparación
        </h2>
        <Zone kind="preparing" numbers={preparing} highlighted={chime.highlighted} />
      </section>
      <section
        data-testid="zone-ready"
        aria-labelledby="zone-ready-title"
        className="flex min-h-0 min-w-0 flex-col bg-[#05432f] px-[1.5vw] pt-[2vh]"
      >
        <h2 id="zone-ready-title" className="font-display text-[5.4vh] leading-tight font-extrabold text-cheddar-400">
          ¡Listo! Retiralo en el mostrador
        </h2>
        <Zone kind="ready" numbers={ready} highlighted={chime.highlighted} />
      </section>
      <footer className="col-span-2 flex min-h-10 items-center gap-4 bg-black/40 px-[1.5vw] py-1">
        {chime.hint === "locked" && (
          <p data-testid="sound-hint" className="text-sm font-semibold text-white/80">
            Tocá la pantalla para activar el sonido
          </p>
        )}
        <div className="ml-auto flex items-center gap-4">
          <LiveRefresh dark />
          <button
            type="button"
            data-testid="sound-toggle"
            aria-pressed={chime.soundOn}
            aria-label={`Sonido: ${chime.soundOn ? "activado" : "silenciado"}`}
            title={chime.soundOn ? "Silenciar el aviso de pedidos listos" : "Activar el aviso de pedidos listos"}
            onClick={() => void chime.toggleSound()}
            className="inline-flex min-h-9 items-center gap-2 rounded-full border border-white/30 px-3 text-sm font-semibold text-white/80 hover:bg-white/10"
          >
            <span aria-hidden="true" className={`size-2.5 rounded-full ${chime.soundOn ? "bg-green-500" : "bg-slate-500"}`} />
            {chime.soundOn ? "Sonido" : "Silenciado"}
          </button>
        </div>
      </footer>
      <p role="status" aria-live="polite" className="sr-only">
        {ready.filter((o) => chime.highlighted.has(o.id)).map((o) => `Pedido ${o.number} listo`).join(". ")}
      </p>
    </div>
  );
}

/** Font bounds per zone, as a fraction of the viewport height (1080 p: ready 67-238 px, preparation 43-119 px). */
const BOUNDS = {
  preparing: { min: 0.04, max: 0.11 },
  ready: { min: 0.062, max: 0.22 },
} as const;

/** Auto-scroll: pixels per second and the pause at each end. */
const SCROLL_SPEED = 30;
const SCROLL_PAUSE_MS = 3000;

function Zone({ kind, numbers, highlighted }: { kind: "preparing" | "ready"; numbers: BoardNumber[]; highlighted: ReadonlySet<number> }) {
  const viewport = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0, vh: 0 });

  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight, vh: window.innerHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const digits = Math.max(2, ...numbers.map((o) => String(o.number).length));
  const vh = box.vh || 1080;
  const fit = fitNumbers({
    count: numbers.length,
    width: box.w,
    height: box.h,
    maxFont: Math.round(vh * BOUNDS[kind].max),
    minFont: Math.round(vh * BOUNDS[kind].min),
    digits,
  });
  const measured = box.w > 0;

  // Gentle ping-pong scroll, only when even the smallest size does not fit.
  useEffect(() => {
    const el = viewport.current;
    if (!el || !fit.scroll) {
      if (el) el.scrollTop = 0;
      return;
    }
    let raf = 0;
    let last = performance.now();
    let dir = 1;
    let pausedUntil = last + SCROLL_PAUSE_MS;
    const step = (t: number) => {
      const dt = t - last;
      last = t;
      if (t >= pausedUntil) {
        const max = el.scrollHeight - el.clientHeight;
        const next = Math.min(max, Math.max(0, el.scrollTop + (dir * SCROLL_SPEED * dt) / 1000));
        el.scrollTop = next;
        if ((dir > 0 && next >= max) || (dir < 0 && next <= 0)) {
          dir = -dir;
          pausedUntil = t + SCROLL_PAUSE_MS;
        }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [fit.scroll]);

  return (
    <div
      ref={viewport}
      data-testid="zone-viewport"
      data-autoscroll={fit.scroll ? "true" : "false"}
      className="mt-[1.5vh] mb-[1vh] min-h-0 flex-1 overflow-hidden"
    >
      <ol
        className="grid content-start"
        style={{
          gridTemplateColumns: `repeat(${fit.columns}, minmax(0, 1fr))`,
          gridAutoRows: measured ? `${fit.font * CELL_H_EM}px` : undefined,
          visibility: measured ? "visible" : "hidden",
        }}
      >
        {numbers.map((o) => {
          const lit = highlighted.has(o.id);
          return (
            <li
              key={o.id}
              data-testid="board-number"
              data-order-number={o.number}
              className={`relative flex items-center justify-center overflow-hidden font-display leading-none font-extrabold tabular-nums ${
                kind === "ready" ? "text-white" : "text-white/85"
              }`}
              style={{ fontSize: `${fit.font}px` }}
            >
              {lit && (
                <span
                  data-testid="ready-highlight"
                  aria-hidden="true"
                  className="absolute inset-[6%] animate-pulse rounded-2xl bg-cheddar-400/25 ring-4 ring-cheddar-400"
                />
              )}
              <span className="relative">{o.number}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
