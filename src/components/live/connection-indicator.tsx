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
export function ConnectionIndicator({ state, large = false }: { state: LiveState; large?: boolean }) {
  return (
    <span
      role="status"
      data-state={state}
      className={`inline-flex items-center gap-1.5 font-medium text-ink-muted ${large ? "text-sm" : "text-xs"}`}
    >
      <span aria-hidden="true" className={`rounded-full ${large ? "size-2.5" : "size-2"} ${DOT[state]}`} />
      {LABEL[state]}
    </span>
  );
}
