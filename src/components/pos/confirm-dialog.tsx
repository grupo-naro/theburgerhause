"use client";

import { useEffect, useId, useRef } from "react";

type Props = {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Small destructive-action confirmation as a native modal <dialog> (Esc cancels; focus starts on Cancelar). */
export function ConfirmDialog({ title, body, confirmLabel, onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const uid = useId();
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={`${uid}-t`}
      aria-describedby={`${uid}-b`}
      data-testid="confirm-dialog"
      onClose={onCancel}
      className="fixed inset-0 m-auto h-fit w-[min(26rem,calc(100vw-2rem))] animate-sheet-in rounded-3xl border-0 bg-surface p-6 text-ink backdrop:bg-ink/55 open:block"
    >
      <h2 id={`${uid}-t`} className="font-display text-2xl font-extrabold">
        {title}
      </h2>
      <p id={`${uid}-b`} className="mt-1 text-lg text-ink-muted">
        {body}
      </p>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="min-h-14 rounded-full border-2 border-line bg-surface font-display text-lg font-bold hover:bg-brand-50"
        >
          Cancelar
        </button>
        <button
          type="button"
          data-testid="confirm-yes"
          onClick={onConfirm}
          className="min-h-14 rounded-full bg-state-error font-display text-lg font-extrabold text-white hover:bg-red-700"
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
