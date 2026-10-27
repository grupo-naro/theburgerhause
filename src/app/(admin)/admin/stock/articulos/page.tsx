import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getDb } from "@/db/client";
import { requireSessionOrRedirect } from "@/lib/auth/guards";
import { KIND_LABEL } from "@/lib/stock/labels";
import { formatQuantity } from "@/lib/stock/quantity";
import { listStockItems } from "@/lib/stock/queries";
import { StatusBadge } from "../_components/status-badge";

export const metadata = { title: "Artículos de stock · Administración" };

export default async function ArticulosPage() {
  await requireSessionOrRedirect(["admin", "encargado"], "/admin/stock/articulos");
  const items = await listStockItems(getDb());
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-extrabold text-brand-600">Artículos</h1>
        <Link href="/admin/stock/articulos/nuevo" className={buttonClass("primary")}>
          Nuevo artículo
        </Link>
      </div>
      <p className="text-sm text-ink-muted">Las bebidas se ligan a un producto desde el formulario del producto en Menú.</p>
      {items.length === 0 ? (
        <Card>
          <p className="text-ink-muted">Todavía no hay artículos.</p>
        </Card>
      ) : (
        <ul aria-label="Artículos" className="grid gap-3 md:grid-cols-2">
          {items.map((i) => (
            <li key={i.id} className={`flex flex-col gap-3 rounded-2xl border border-line p-3 ${i.active ? "bg-surface" : "bg-slate-50 text-ink-muted"}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium [overflow-wrap:anywhere]">{i.name}</p>
                  <p className="text-sm text-ink-muted">
                    {KIND_LABEL[i.kind]} · {formatQuantity(i.quantity, i.unit)}
                  </p>
                </div>
                {i.active ? <StatusBadge status={i.status} /> : <Badge tone="muted">Dado de baja</Badge>}
              </div>
              <Link href={`/admin/stock/articulos/${i.id}`} className={buttonClass("secondary", "md")}>
                Editar {i.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
