/** Shown until the stored cart is loaded: never claim "vacío" before we know. */
export function CartSkeleton() {
  return (
    <ul aria-hidden="true" data-testid="cart-skeleton" className="space-y-3">
      {[0, 1, 2].map((i) => (
        <li key={i} className="flex animate-pulse gap-3 rounded-2xl border border-line bg-surface p-3">
          <span className="size-16 rounded-xl bg-brand-50" />
          <span className="flex-1 space-y-2 py-1">
            <span className="block h-5 w-2/3 rounded bg-brand-50" />
            <span className="block h-4 w-1/2 rounded bg-brand-50" />
          </span>
        </li>
      ))}
    </ul>
  );
}
