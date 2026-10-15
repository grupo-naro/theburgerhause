import type { ReactNode } from "react";

/** A numbered checkout step: rounded card with a badge, the heading and its content. */
export function CheckoutSection({
  n,
  title,
  headingId,
  children,
}: {
  n: number;
  title: string;
  headingId: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={headingId} className="rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-5">
      <h2 id={headingId} className="flex items-center gap-3 font-display text-xl font-extrabold text-ink">
        <span
          aria-hidden="true"
          className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-600 font-display text-base font-extrabold text-white"
        >
          {n}
        </span>
        {title}
      </h2>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}
