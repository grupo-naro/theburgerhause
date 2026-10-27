import { randomUUID } from "node:crypto";
import { Card } from "@/components/ui/card";
import { getDb } from "@/db/client";
import { businessDateFor } from "@/db/order-number";
import { requireSessionOrRedirect } from "@/lib/auth/guards";
import { getBusinessDayCutoff } from "@/lib/settings";
import { listStockItems } from "@/lib/stock/queries";
import { ConsumoForm } from "../_components/consumo-form";

export const metadata = { title: "Consumo del día · Administración" };

export default async function ConsumoPage() {
  await requireSessionOrRedirect(["admin", "encargado"], "/admin/stock/consumo");
  const db = getDb();
  const [items, cutoff] = await Promise.all([listStockItems(db), getBusinessDayCutoff(db)]);
  const lines = items.filter((i) => i.active).map((i) => ({ id: i.id, name: i.name, unit: i.unit, quantity: i.quantity }));
  const today = businessDateFor(new Date(), cutoff);
  return (
    <section className="flex flex-col gap-5">
      <h1 className="font-display text-3xl font-extrabold text-brand-600">Consumo del día</h1>
      <p className="text-sm text-ink-muted">Cargá cuánto se usó de cada artículo. Dejá en blanco lo que no se usó.</p>
      {lines.length === 0 ? (
        <Card>
          <p className="text-ink-muted">No hay artículos activos.</p>
        </Card>
      ) : (
        <ConsumoForm lines={lines} today={today} initialKey={randomUUID()} />
      )}
    </section>
  );
}
