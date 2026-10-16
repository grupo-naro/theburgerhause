import { formatMoney } from "@/lib/rendicion/shortage";
import { formatSettledAt } from "@/lib/rendicion/receipt";
import type { OwedOrder } from "@/lib/settlements/queries";

const itemsSummary = (o: OwedOrder) => o.items.map((i) => `${i.quantity}× ${i.name}`).join(", ");

/** Every cash order the cadet delivered and still owes: the settlement is all-or-nothing, nothing is selectable. */
export function OwedOrdersTable({ orders, total, now }: { orders: OwedOrder[]; total: number; now: Date }) {
  if (orders.length === 0) {
    return (
      <p data-testid="owed-empty" className="rounded-2xl border border-line bg-surface px-5 py-8 text-center text-lg text-ink-muted">
        No hay pedidos en efectivo pendientes de rendir.
      </p>
    );
  }
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      <table data-testid="owed-table" className="w-full text-left text-base">
        <caption className="sr-only">Pedidos en efectivo entregados, pendientes de rendir</caption>
        <thead className="bg-brand-50 text-sm font-bold text-ink-muted">
          <tr>
            <th scope="col" className="px-4 py-3">Pedido</th>
            <th scope="col" className="px-4 py-3">Entregado</th>
            <th scope="col" className="px-4 py-3">Dirección y pedido</th>
            <th scope="col" className="px-4 py-3 text-right">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {orders.map((o) => (
            <tr key={o.id} data-testid="owed-row" data-order-number={o.number} className="align-top">
              <th scope="row" className="px-4 py-3 font-display text-xl font-extrabold whitespace-nowrap">#{o.number}</th>
              <td className="px-4 py-3 whitespace-nowrap text-ink-muted">{o.deliveredAt ? formatSettledAt(o.deliveredAt, now) : "—"}</td>
              <td className="px-4 py-3">
                <p className="font-semibold break-words">{o.address ?? "Sin dirección"}</p>
                <p className="text-sm break-words text-ink-muted">{itemsSummary(o)}</p>
              </td>
              <td className="px-4 py-3 text-right text-lg font-bold whitespace-nowrap tabular-nums">{formatMoney(o.total)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-ink bg-brand-50">
            <th scope="row" colSpan={3} className="px-4 py-3 text-lg font-bold">
              Total a rendir
            </th>
            <td data-testid="owed-table-total" className="px-4 py-3 text-right font-display text-2xl font-extrabold whitespace-nowrap tabular-nums">
              {formatMoney(total)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
