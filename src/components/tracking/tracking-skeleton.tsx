/** Shown while the order is read (the page is dynamic). */
export function TrackingSkeleton() {
  return (
    <div className="mx-auto max-w-[1100px] px-4 pb-8 pt-6 md:pt-8">
      <div aria-hidden="true" data-testid="tracking-skeleton" className="grid animate-pulse items-start gap-4 lg:grid-cols-[1fr_24rem]">
        <div className="space-y-4">
          <div className="space-y-3 rounded-2xl border border-line bg-surface p-5">
            <span className="block h-4 w-1/3 rounded bg-brand-50" />
            <span className="block h-12 w-28 rounded bg-brand-50" />
            <span className="block h-7 w-2/3 rounded bg-brand-50" />
            {[0, 1, 2, 3, 4].map((i) => (
              <span key={i} className="block h-8 rounded-xl bg-brand-50" />
            ))}
          </div>
          <div className="space-y-3 rounded-2xl border border-line bg-surface p-5">
            <span className="block h-6 w-1/3 rounded bg-brand-50" />
            <span className="block h-12 rounded-xl bg-brand-50" />
          </div>
        </div>
        <div className="space-y-3 rounded-2xl border border-line bg-surface p-5">
          <span className="block h-6 w-1/3 rounded bg-brand-50" />
          <span className="block h-16 rounded-xl bg-brand-50" />
          <span className="block h-10 rounded-xl bg-brand-50" />
        </div>
      </div>
    </div>
  );
}
