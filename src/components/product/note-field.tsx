"use client";

import { useId, useState } from "react";
import { NOTE_MAX } from "@/lib/cart/normalize";

type Props = { value: string; onChange: (note: string) => void };

/** Collapsed "Agregar una nota" disclosure; opens by itself when there is already a note (edit mode). */
export function NoteField({ value, onChange }: Props) {
  const [open, setOpen] = useState(value.trim() !== "");
  const id = useId();
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-5 inline-flex min-h-11 items-center rounded-full px-1 text-sm font-bold text-brand-600 underline-offset-4 hover:underline"
      >
        Agregar una nota
      </button>
    );
  }
  return (
    <div className="mt-5">
      <label htmlFor={id} className="mb-1 block font-display text-base font-bold text-ink">
        Nota para la cocina
      </label>
      <textarea
        id={id}
        value={value}
        maxLength={NOTE_MAX}
        rows={2}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Ej.: bien cocida, sin sal"
        className="w-full resize-none rounded-xl border border-line bg-surface px-3 py-2 text-base text-ink placeholder:text-ink-muted/70"
      />
      <p className="mt-1 text-right text-xs tabular-nums text-ink-muted" aria-hidden="true">
        {value.length}/{NOTE_MAX}
      </p>
    </div>
  );
}
