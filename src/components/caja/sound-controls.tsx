"use client";

import type { SoundHint } from "./use-new-order-alert";

export function SoundToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      data-testid="sound-toggle"
      aria-pressed={on}
      onClick={onToggle}
      className={`inline-flex min-h-12 items-center gap-2 rounded-full border-2 px-5 font-bold transition-colors ${
        on ? "border-green-700 bg-green-50 text-green-800" : "border-line bg-surface text-ink hover:bg-brand-50"
      }`}
    >
      <span aria-hidden="true">{on ? "🔔" : "🔕"}</span>
      Sonido: {on ? "activado" : "desactivado"}
    </button>
  );
}

const HINT_TEXT: Record<Exclude<SoundHint, null>, string> = {
  off: "Activá el sonido para escuchar los pedidos nuevos",
  locked: "Tocá cualquier parte de la pantalla para habilitar el sonido",
};

export function SoundHintBanner({ hint, onEnable }: { hint: SoundHint; onEnable: () => void }) {
  if (!hint) return null;
  return (
    <div
      data-testid="sound-hint"
      className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 border-cheddar-600 bg-cheddar-400/25 px-5 py-3"
    >
      <p className="text-lg font-bold text-ink">{HINT_TEXT[hint]}</p>
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
