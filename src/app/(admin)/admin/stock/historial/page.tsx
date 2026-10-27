import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getDb } from "@/db/client";
import { requireSessionOrRedirect } from "@/lib/auth/guards";
import { listMovements } from "@/lib/stock/queries";
import { MovementCard, type MovementView } from "../_components/movement-card";

export const metadata = { title: "Historial de stock · Administración" };

const when = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "America/Argentina/Buenos_Aires",
});

export default async function HistorialPage({ searchParams }: PageProps<"/admin/stock/historial">) {
  const sp = await searchParams;
  await requireSessionOrRedirect(["admin", "encargado"], "/admin/stock/historial");
  // Untrusted query param: a malformed id just shows everything.
  const raw = typeof sp.item === "string" && /^\d{1,9}$/.test(sp.item) ? Number(sp.item) : undefined;
  const rows = await listMovements(getDb(), { itemId: raw, limit: 100 });
  const views: MovementView[] = rows.map((r) => ({
    id: r.id,
    itemName: r.itemName,
    unit: r.unit,
    kind: r.kind,
    qtyDelta: r.qtyDelta,
    businessDate: r.businessDate,
    when: when.format(r.createdAt),
    note: r.note,
    userName: r.userName,
    orderId: r.orderId,
    edits: r.edits.map((e) => ({
      previousDelta: e.previousDelta,
      newDelta: e.newDelta,
      editedByName: e.editedByName,
      when: when.format(e.editedAt),
    })),
  }));
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-extrabold text-brand-600">Historial</h1>
        {raw !== undefined ? (
          <Link href="/admin/stock/historial" className={buttonClass("secondary")}>
            Ver todos
          </Link>
        ) : null}
      </div>
      <p className="text-sm text-ink-muted">Últimos movimientos. Las ventas y devoluciones se registran solas y no se editan.</p>
      {views.length === 0 ? (
        <Card>
          <p className="text-ink-muted">Todavía no hay movimientos.</p>
        </Card>
      ) : (
        <ul aria-label="Movimientos" className="grid gap-3 md:grid-cols-2">
          {views.map((m) => (
            <MovementCard key={m.id} m={m} />
          ))}
        </ul>
      )}
    </section>
  );
}
