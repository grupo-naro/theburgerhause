import Link from "next/link";

/**
 * Fixed strip on the cashier's screens other than Mostrador while app takeaway orders wait for approval.
 * No close control: it goes away when nothing is pending (the shell re-renders on every live event).
 */
export function PendingAppOrdersBanner({ count }: { count: number }) {
  const text = count === 1 ? `🔔 ${count} pedido de la app por aprobar` : `🔔 ${count} pedidos de la app por aprobar`;
  return (
    <div
      role="status"
      data-testid="pending-app-banner"
      className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 border-cheddar-600 bg-state-pending px-4 py-3 text-ink"
    >
      <p className="text-lg font-extrabold">{text}</p>
      <Link
        href="/mostrador/pedidos"
        className="inline-flex min-h-11 items-center rounded-full bg-ink px-5 text-base font-bold text-white hover:bg-ink/90"
      >
        Ver y aprobar
      </Link>
    </div>
  );
}
