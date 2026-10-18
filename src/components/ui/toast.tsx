"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export type ToastAction = { label: string; href?: string; onClick?: () => void; /** 56 px target (touch screens such as the kitchen). */ large?: boolean };
export type ToastOptions = { message: string; action?: ToastAction; durationMs?: number };
type ActiveToast = ToastOptions & { id: number };

type ToastApi = { show: (toast: ToastOptions) => void; dismiss: () => void };

const ToastContext = createContext<ToastApi | null>(null);

const DEFAULT_DURATION_MS = 4000;

/**
 * One toast at a time (a new one replaces the previous). The live region is always mounted so
 * screen readers announce the text politely when it appears. The timer pauses while the toast is
 * hovered or focused (so its action can be reached) and restarts when the pointer / focus leaves.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ActiveToast | null>(null);
  const [paused, setPaused] = useState(false);
  const nextId = useRef(0);

  const show = useCallback((options: ToastOptions) => {
    nextId.current += 1;
    setPaused(false);
    setToast({ ...options, id: nextId.current });
  }, []);
  const dismiss = useCallback(() => setToast(null), []);

  useEffect(() => {
    if (!toast || paused) return;
    const timer = window.setTimeout(() => setToast(null), toast.durationMs ?? DEFAULT_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [toast, paused]);

  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))] z-50 flex justify-center"
      >
        {toast && (
          <div
            key={toast.id}
            data-testid="toast"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            onFocus={() => setPaused(true)}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget)) setPaused(false);
            }}
            className="pointer-events-auto flex max-w-full animate-toast-in items-center gap-3 rounded-full bg-ink py-1.5 pl-5 pr-1.5 text-white shadow-[0_8px_24px_rgba(11,31,58,0.35)]"
          >
            <span className={`py-1.5 font-medium ${toast.action?.large ? "text-lg" : "text-sm"}`}>{toast.message}</span>
            {toast.action && <ToastActionButton action={toast.action} onDone={dismiss} />}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

const actionClass =
  "inline-flex shrink-0 items-center rounded-full bg-cheddar-400 px-4 text-sm font-bold text-ink transition-colors hover:bg-cheddar-600 focus-visible:outline-white";

function ToastActionButton({ action, onDone }: { action: ToastAction; onDone: () => void }) {
  const cls = `${actionClass} ${action.large ? "min-h-14 text-base" : "min-h-11"}`;
  if (action.href) {
    return (
      <Link href={action.href} onClick={onDone} className={cls}>
        {action.label}
      </Link>
    );
  }
  return (
    <button
      type="button"
      className={cls}
      onClick={() => {
        action.onClick?.();
        onDone();
      }}
    >
      {action.label}
    </button>
  );
}

export function useToast(): ToastApi {
  const value = useContext(ToastContext);
  if (!value) throw new Error("useToast must be used inside <ToastProvider>");
  return value;
}
