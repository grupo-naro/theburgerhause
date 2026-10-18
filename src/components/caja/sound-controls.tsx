"use client";

import type { SoundHint } from "./use-new-order-alert";

/** `compact` (the shell header) shows just "Sonido" and a status dot: the full state stays in aria-label / title. */
export function SoundToggle({ on, onToggle, compact = false, dark = false }: { on: boolean; onToggle: () => void; compact?: boolean; dark?: boolean }) {
  return (
    <button
      type="button"
      data-testid="sound-toggle"
      aria-pressed={on}
      aria-label={compact ? `Sonido: ${on ? "activado" : "desactivado"}` : undefined}
      title={compact ? `Sonido de pedidos nuevos: ${on ? "activado" : "desactivado"}` : undefined}
      onClick={onToggle}
      className={`inline-flex ${dark ? "min-h-14" : "min-h-12"} items-center gap-2 rounded-full border-2 ${compact ? "px-3" : "px-5"} font-bold transition-colors ${
        dark
          ? on
            ? "border-emerald-400 bg-emerald-950 text-emerald-100"
            : "border-white/40 bg-transparent text-white hover:bg-white/10"
          : on
            ? "border-green-700 bg-green-50 text-green-800"
            : "border-line bg-surface text-ink hover:bg-brand-50"
      }`}
    >
      <span aria-hidden="true" className={`size-2.5 rounded-full ${on ? "bg-green-600" : "bg-slate-400"}`} />
      {compact ? "Sonido" : `Sonido: ${on ? "activado" : "desactivado"}`}
    </button>
  );
}

const HINT_TEXT: Record<Exclude<SoundHint, null>, string> = {
  off: "Activá el sonido para escuchar los pedidos nuevos",
  locked: "Tocá cualquier parte de la pantalla para habilitar el sonido",
};

export function SoundHintBanner({ hint, onEnable, dark = false }: { hint: SoundHint; onEnable: () => void; dark?: boolean }) {
  if (!hint) return null;
  return (
    <div
      data-testid="sound-hint"
      className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 px-5 py-3 ${dark ? "border-cheddar-400 bg-cheddar-400/15" : "border-cheddar-600 bg-cheddar-400/25"}`}
    >
      <p className={`text-lg font-bold ${dark ? "text-white" : "text-ink"}`}>{HINT_TEXT[hint]}</p>
      {hint === "off" && (
        <button
          type="button"
          onClick={onEnable}
          className="min-h-12 rounded-full bg-cheddar-400 px-6 font-display text-lg font-bold text-ink hover:bg-cheddar-600"
        >
          Activar sonido
        </button>
      )}
    </div>
  );
}
