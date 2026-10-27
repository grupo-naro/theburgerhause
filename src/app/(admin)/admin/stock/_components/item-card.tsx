import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { formatQuantity } from "@/lib/stock/quantity";
import type { StockItemRow } from "@/lib/stock/queries";
import { StatusBadge } from "./status-badge";

/** One stock item: name, balance and status as text, and the two usual next steps. */
export function ItemCard({ item }: { item: StockItemRow }) {
  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium [overflow-wrap:anywhere]">{item.name}</p>
          <p className="text-lg font-bold">{formatQuantity(item.quantity, item.unit)}</p>
          {item.minQty > 0 ? <p className="text-xs text-ink-muted">Mínimo: {formatQuantity(item.minQty, item.unit)}</p> : null}
        </div>
        <StatusBadge status={item.status} />
      </div>
      <div className="flex items-start gap-2">
        <Link href={`/admin/stock/reponer?item=${item.id}`} className={`${buttonClass("secondary", "md")} flex-1`}>
          Reponer
        </Link>
        <Link href={`/admin/stock/historial?item=${item.id}`} className={`${buttonClass("secondary", "md")} flex-1`}>
          Historial
        </Link>
      </div>
    </li>
  );
}
