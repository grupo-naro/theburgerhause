import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { StaffShell, StaffShellFallback } from "@/components/staff/staff-shell";
import { getDb } from "@/db/client";
import { requireSessionOrRedirect } from "@/lib/auth/guards";
import { KIND_SECTION, STATUS_LABEL } from "@/lib/stock/labels";
import { listStockItems } from "@/lib/stock/queries";
import { formatQuantity, STOCK_KINDS } from "@/lib/stock/quantity";

export const metadata = { title: "Stock · The Burger House 828" };

const TONE = { ok: "success", poco: "warning", agotado: "danger" } as const;

/** Read-only stock for every staff role: balances and status, NO loading controls (those live in the admin area). */
async function StockPage() {
  const session = await requireSessionOrRedirect(["cajera", "encargada_delivery", "cocina", "encargado", "admin"], "/stock");
  const items = (await listStockItems(getDb())).filter((i) => i.active);
  return (
    <StaffShell session={session}>
      <section className="flex flex-col gap-5">
        <h1 className="font-display text-3xl font-extrabold text-brand-600">Stock</h1>
        {items.length === 0 ? (
          <Card>
            <p className="text-ink-muted">Todavía no hay artículos cargados.</p>
          </Card>
        ) : (
          STOCK_KINDS.map((kind) => {
            const ofKind = items.filter((i) => i.kind === kind);
            if (ofKind.length === 0) return null;
            return (
              <section key={kind} aria-labelledby={`stock-${kind}`} className="flex flex-col gap-3">
                <h2 id={`stock-${kind}`} className="font-display text-xl font-bold">
                  {KIND_SECTION[kind]}
                </h2>
                <ul aria-label={KIND_SECTION[kind]} className="grid gap-3 md:grid-cols-2">
                  {ofKind.map((i) => (
                    <li key={i.id} className="flex items-start justify-between gap-3 rounded-2xl border border-line bg-surface p-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium [overflow-wrap:anywhere]">{i.name}</p>
                        <p className="text-lg font-bold">{formatQuantity(i.quantity, i.unit)}</p>
                        {i.minQty > 0 ? <p className="text-xs text-ink-muted">Mínimo: {formatQuantity(i.minQty, i.unit)}</p> : null}
                      </div>
                      <Badge tone={TONE[i.status]}>{STATUS_LABEL[i.status]}</Badge>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })
        )}
      </section>
    </StaffShell>
  );
}

/** Dynamic (cookies + DB): everything runs inside Suspense; the guard runs in the page itself. */
export default function Page() {
  return (
    <Suspense fallback={<StaffShellFallback />}>
      <StockPage />
    </Suspense>
  );
}
