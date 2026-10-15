import type { LiveState } from "@/lib/events/client-state";

const LABEL: Record<LiveState, string> = {
  live: "En vivo",
  connecting: "Reconectando…",
  offline: "Sin conexión",
};

const DOT: Record<LiveState, string> = {
  live: "bg-state-ready",
  connecting: "bg-state-pending animate-pulse",
  offline: "bg-state-error",
};

/** Small status dot + label. The text is the accessible name; the dot is decorative. */
export function ConnectionIndicator({ state }: { state: LiveState }) {
  return (
    <span role="status" data-state={state} className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted">
      <span aria-hidden="true" className={`size-2 rounded-full ${DOT[state]}`} />
      {LABEL[state]}
    </span>
  );
}
