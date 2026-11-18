import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/field";
import { getDb } from "@/db/client";
import { requireSessionOrRedirect } from "@/lib/auth/guards";
import { formatPesosInput } from "@/lib/rendicion/parse-pesos";
import { formatPriceChange, formatPurchaseMoney } from "@/lib/stock/purchase-math";
import { listPurchases, listUnpricedIngresos, type Purchase } from "@/lib/stock/purchases";
import { formatQuantity, type Unit } from "@/lib/stock/quantity";
import { listStockItems } from "@/lib/stock/queries";
import { PurchasePriceForm } from "../_components/purchase-price-form";

export const metadata = { title: "Precios de compra · Administración" };

/** Newest purchases per article in the overview; one article's view shows its whole history (up to this cap). */
const OVERVIEW_PER_ITEM = 12;
const ITEM_PER_ITEM = 200;

/** "2026-11-18" -> "18/11/26". */
const shortDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}`;

function ChangeBadge({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  const tone = pct > 0 ? "text-red-700" : pct < 0 ? "text-green-700" : "text-ink-muted";
  return (
    <span data-testid="price-change" className={`font-semibold whitespace-nowrap ${tone}`}>
      {formatPriceChange(pct)}
    </span>
  );
}

function PurchaseRow({ p, unit }: { p: Purchase; unit: Unit }) {
  return (
    <li className="flex flex-col gap-2 border-t border-line pt-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-sm text-ink-muted">{shortDate(p.businessDate)}</span>
        <span className="[overflow-wrap:anywhere]">
          {formatQuantity(p.milli, unit)} × {formatPurchaseMoney(p.unitPrice)} = <strong>{formatPurchaseMoney(p.total)}</strong>
        </span>
        <ChangeBadge pct={p.changePct} />
        {p.userName ? <span className="text-sm text-ink-muted">{p.userName}</span> : null}
      </div>
      {p.note ? <p className="text-sm [overflow-wrap:anywhere]">Nota: {p.note}</p> : null}
      <PurchasePriceForm movementId={p.movementId} initialPrice={formatPesosInput(p.unitPrice)} openLabel="Editar precio" context={`del ${shortDate(p.businessDate)}`} />
    </li>
  );
}

export default async function PreciosPage({ searchParams }: PageProps<"/admin/stock/precios">) {
  await requireSessionOrRedirect(["admin"], "/admin/stock/precios");
  const sp = await searchParams;
  const db = getDb();
  const items = await listStockItems(db);
  // Untrusted query param: only filter when it matches an item.
  const raw = typeof sp.item === "string" && /^\d+$/.test(sp.item) ? Number(sp.item) : null;
  const selected = items.find((i) => i.id === raw) ?? null;
  const [groups, unpriced] = await Promise.all([
    listPurchases(db, selected ? { itemId: selected.id, perItem: ITEM_PER_ITEM } : { perItem: OVERVIEW_PER_ITEM }),
    selected ? listUnpricedIngresos(db, selected.id) : Promise.resolve([]),
  ]);

  return (
    <section className="flex flex-col gap-5">
      <h1 className="font-display text-3xl font-extrabold text-brand-600">Precios de compra</h1>
      <form method="get" className="flex max-w-xl flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <Field label="Artículo" htmlFor="item">
            <Select id="item" name="item" defaultValue={selected ? String(selected.id) : ""}>
              <option value="">Todos</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Button type="submit" variant="secondary">
          Ver
        </Button>
      </form>

      {groups.length === 0 ? (
        <Card>
          <p className="text-ink-muted">Todavía no hay compras con precio. Cargá el precio al reponer stock.</p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-4">
          {groups.map((g) => (
            <li key={g.itemId} data-testid="purchase-group">
              <Card className="flex flex-col gap-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="font-display text-xl font-extrabold [overflow-wrap:anywhere]">
                    {g.itemName} ({g.unit})
                  </h2>
                  <p className="flex flex-wrap items-baseline gap-2">
                    <span>
                      Último: <strong>{formatPurchaseMoney(g.last.unitPrice)}</strong> / {g.unit}
                    </span>
                    <ChangeBadge pct={g.last.changePct} />
                  </p>
                </div>
                <ul className="flex flex-col gap-3">
                  {g.purchases.map((p) => (
                    <PurchaseRow key={p.movementId} p={p} unit={g.unit} />
                  ))}
                </ul>
                {g.hasMore ? (
                  selected ? (
                    <p className="text-sm text-ink-muted">Se muestran las últimas {ITEM_PER_ITEM} compras.</p>
                  ) : (
                    <Link href={`/admin/stock/precios?item=${g.itemId}`} className="flex min-h-11 items-center font-semibold text-brand-600 underline">
                      Ver todas las compras de {g.itemName}
                    </Link>
                  )
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}

      {selected && unpriced.length > 0 ? (
        <section aria-labelledby="unpriced-title" className="flex flex-col gap-3">
          <h2 id="unpriced-title" className="font-display text-xl font-extrabold">
            Reposiciones sin precio
          </h2>
          <ul className="flex flex-col gap-3">
            {unpriced.map((m) => (
              <li key={m.movementId} className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-3">
                <p>
                  <span className="text-sm text-ink-muted">{shortDate(m.businessDate)}</span> · {formatQuantity(m.milli, selected.unit)}
                  {m.userName ? <span className="text-sm text-ink-muted"> · {m.userName}</span> : null}
                </p>
                <PurchasePriceForm movementId={m.movementId} initialPrice="" openLabel="Agregar precio" context={`del ${shortDate(m.businessDate)}`} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}
