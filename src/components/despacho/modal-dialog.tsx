"use client";

import { useEffect, useRef, type ReactNode } from "react";

type Props = {
  titleId: string;
  testId: string;
  busy: boolean;
  onCancel: () => void;
  children: ReactNode;
};

/**
 * Native modal <dialog> shell shared by the dispatch dialogs. Mounted only while open: it opens
 * itself, closes on Esc / backdrop click (unless busy) and gives focus back to whoever opened it.
 */
export function ModalDialog({ titleId, testId, busy, onCancel, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      data-testid={testId}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-0 text-ink shadow-[0_24px_64px_rgba(11,31,58,0.35)] backdrop:bg-ink/60"
    >
      {children}
    </dialog>
  );
}
