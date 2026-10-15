/** Shown until the stored cart is loaded (and while an empty cart redirects to /carrito). */
export function CheckoutSkeleton() {
  return (
    <div aria-hidden="true" data-testid="checkout-skeleton" className="grid animate-pulse items-start gap-5 lg:grid-cols-[1fr_24rem]">
      <div className="space-y-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-3 rounded-2xl border border-line bg-surface p-5">
            <span className="block h-6 w-1/3 rounded bg-brand-50" />
            <span className="block h-12 rounded-xl bg-brand-50" />
            <span className="block h-12 rounded-xl bg-brand-50" />
          </div>
        ))}
      </div>
      <div className="space-y-3 rounded-2xl border border-line bg-surface p-5">
        <span className="block h-6 w-1/3 rounded bg-brand-50" />
        <span className="block h-16 rounded-xl bg-brand-50" />
        <span className="block h-14 rounded-full bg-brand-50" />
      </div>
    </div>
  );
}
