import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { requireSessionOrRedirect } from "@/lib/auth/guards";
import { formatQuantity } from "@/lib/stock/quantity";
import { InitialStockForm } from "../../_components/initial-stock-form";
import { ItemForm } from "../../_components/item-form";

export const metadata = { title: "Editar artículo · Administración" };

export default async function EditarArticuloPage({ params }: PageProps<"/admin/stock/articulos/[id]">) {
  const { id: rawId } = await params;
  const id = /^\d{1,9}$/.test(rawId) ? Number(rawId) : NaN;
  await requireSessionOrRedirect(["admin", "encargado"], `/admin/stock/articulos/${encodeURIComponent(rawId)}`);
  const db = getDb();
  const [item] = Number.isSafeInteger(id) ? await db.select().from(s.stockItems).where(eq(s.stockItems.id, id)) : [];
  if (!item) notFound();
  const [initial] = await db
    .select({ id: s.stockMovements.id })
    .from(s.stockMovements)
    .where(and(eq(s.stockMovements.itemId, item.id), eq(s.stockMovements.kind, "ajuste_inicial")));
  return (
    <section className="flex flex-col gap-5">
      <h1 className="font-display text-3xl font-extrabold text-brand-600">Editar artículo</h1>
      <p className="text-sm text-ink-muted">Saldo actual: {formatQuantity(item.quantity, item.unit)}</p>
      {!initial && item.active ? <InitialStockForm itemId={item.id} unit={item.unit} /> : null}
      <ItemForm
        key={item.id}
        initial={{
          id: item.id,
          name: item.name,
          kind: item.kind,
          unit: item.unit,
          minQty: item.minQty === 0 ? "" : formatQuantity(item.minQty, item.unit).replace(/ \S+$/, ""),
          active: item.active,
        }}
      />
    </section>
  );
}
