import { elapsedMs, formatElapsed, urgencyOf, type Urgency } from "@/lib/caja/elapsed";

const TONE: Record<Urgency, string> = {
  normal: "bg-slate-100 text-slate-700",
  warning: "bg-amber-100 text-amber-900 ring-2 ring-state-pending",
  urgent: "bg-state-error text-white",
};
const TAG: Record<Urgency, string | null> = { normal: null, warning: "Demora", urgent: "Urgente" };

/** Waiting time with its escalation. The word (Demora / Urgente) backs up the colour. */
export function ElapsedBadge({ createdAt, now }: { createdAt: string; now: number }) {
  const urgency = urgencyOf(elapsedMs(createdAt, new Date(now)));
  const tag = TAG[urgency];
  return (
    <span
      data-testid="elapsed"
      data-urgency={urgency}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-base font-bold whitespace-nowrap tabular-nums ${TONE[urgency]}`}
    >
      {tag && <span className="uppercase tracking-wide">{tag} ·</span>}
      {formatElapsed(elapsedMs(createdAt, new Date(now)))}
    </span>
  );
}

/** Card accent (left bar) matching the urgency. */
export function urgencyBar(createdAt: string, now: number): string {
  const u = urgencyOf(elapsedMs(createdAt, new Date(now)));
  return u === "urgent" ? "border-l-state-error" : u === "warning" ? "border-l-state-pending" : "border-l-brand-300";
}
