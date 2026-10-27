import { randomUUID } from "node:crypto";
import { Card } from "@/components/ui/card";
import { getDb } from "@/db/client";
import { requireSessionOrRedirect } from "@/lib/auth/guards";
import { listStockItems } from "@/lib/stock/queries";
import { IngresoForm } from "../_components/ingreso-form";

export const metadata = { title: "Reponer stock · Administración" };

export default async function ReponerPage({ searchParams }: PageProps<"/admin/stock/reponer">) {
  const sp = await searchParams;
  await requireSessionOrRedirect(["admin", "encargado"], "/admin/stock/reponer");
  const items = (await listStockItems(getDb())).filter((i) => i.active);
  // Untrusted query param: only preselect when it matches an active item.
  const raw = typeof sp.item === "string" && /^\d+$/.test(sp.item) ? Number(sp.item) : null;
  const initialItemId = items.some((i) => i.id === raw) ? raw : null;
  return (
    <section className="flex flex-col gap-5">
      <h1 className="font-display text-3xl font-extrabold text-brand-600">Reponer stock</h1>
      {items.length === 0 ? (
        <Card>
          <p className="text-ink-muted">No hay artículos activos. Creá uno desde Artículos.</p>
        </Card>
      ) : (
        <IngresoForm
          items={items.map((i) => ({ id: i.id, name: i.name, unit: i.unit, kind: i.kind, quantity: i.quantity }))}
          initialItemId={initialItemId}
          initialKey={randomUUID()}
        />
      )}
    </section>
  );
}
