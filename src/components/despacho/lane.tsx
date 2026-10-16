import type { ReactNode } from "react";

export type LaneTone = "blue" | "green" | "violet";

const TONES: Record<LaneTone, { bar: string; title: string; badge: string }> = {
  blue: { bar: "border-t-state-preparing", title: "text-brand-700", badge: "bg-brand-50 text-brand-700" },
  green: { bar: "border-t-state-ready", title: "text-green-800", badge: "bg-green-100 text-green-800" },
  violet: { bar: "border-t-state-route", title: "text-violet-800", badge: "bg-violet-100 text-violet-800" },
};

type Props = {
  id: string;
  title: string;
  count: number;
  tone: LaneTone;
  /** Shown when the lane has no orders. */
  empty: string;
  actions?: ReactNode;
  className?: string;
  /** Sub-lane inside another lane: smaller heading, lighter frame. */
  sub?: boolean;
  /** Cards in a responsive multi-column grid (a lane that has the whole page for itself). */
  wide?: boolean;
  children: ReactNode;
};

/** A titled lane (column / section) of the board. The heading is focusable so counters can jump to it. */
export function Lane({ id, title, count, tone, empty, actions, className = "", sub = false, wide = false, children }: Props) {
  const t = TONES[tone];
  const Heading = sub ? "h3" : "h2";
  return (
    <section
      id={`lane-${id}`}
      data-testid={`lane-${id}`}
      aria-labelledby={`lane-${id}-h`}
      className={`min-w-0 scroll-mt-4 rounded-2xl border border-line bg-white/60 ${sub ? "border-t-4 p-2.5" : "border-t-8 p-3"} ${t.bar} ${className}`}
    >
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Heading id={`lane-${id}-h`} tabIndex={-1} className={`flex items-center gap-2 font-display text-xl font-extrabold outline-none ${t.title}`}>
          {title}
          <span data-testid={`lane-${id}-count`} className={`rounded-full px-2.5 py-0.5 text-base tabular-nums ${t.badge}`}>
            {count}
          </span>
        </Heading>
        {actions}
      </header>
      {count === 0 ? (
        <p data-testid={`lane-${id}-empty`} className="rounded-xl border-2 border-dashed border-line px-4 py-6 text-center text-base text-ink-muted">
          {empty}
        </p>
      ) : (
        <div className={wide ? "grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3" : "space-y-3"}>{children}</div>
      )}
    </section>
  );
}
