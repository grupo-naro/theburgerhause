import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getDb } from "@/db/client";
import { requireSessionOrRedirect } from "@/lib/auth/guards";
import { KIND_SECTION } from "@/lib/stock/labels";
import { listStockItems } from "@/lib/stock/queries";
import { STOCK_KINDS } from "@/lib/stock/quantity";
import { ItemCard } from "./_components/item-card";

export const metadata = { title: "Stock · Administración" };

export default async function AdminStockPage() {
  await requireSessionOrRedirect(["admin", "encargado"], "/admin/stock");
  const items = (await listStockItems(getDb())).filter((i) => i.active);
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-extrabold text-brand-600">Stock</h1>
        <Link href="/admin/stock/articulos/nuevo" className={buttonClass("primary")}>
          Nuevo artículo
        </Link>
      </div>
      {items.length === 0 ? (
        <Card>
          <p className="text-ink-muted">Todavía no hay artículos. Creá el primero para empezar a controlar el stock.</p>
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
                  <ItemCard key={i.id} item={i} />
                ))}
              </ul>
            </section>
          );
        })
      )}
    </section>
  );
}
