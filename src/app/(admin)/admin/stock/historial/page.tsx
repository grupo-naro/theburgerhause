import Form from "next/form";
import Link from "next/link";
import { Button, buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { getDb } from "@/db/client";
import { requireSessionOrRedirect } from "@/lib/auth/guards";
import { buenosAiresToday, longDay } from "@/lib/stock/closing-dates";
import { listMovements } from "@/lib/stock/queries";
import { businessDateSchema } from "@/lib/stock/schemas";
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
  // Untrusted query params: a malformed id or date just shows everything.
  const raw = typeof sp.item === "string" && /^\d{1,9}$/.test(sp.item) ? Number(sp.item) : undefined;
  const day = typeof sp.dia === "string" && businessDateSchema.safeParse(sp.dia).success ? sp.dia : undefined;
  const rows = await listMovements(getDb(), { itemId: raw, businessDate: day, limit: day !== undefined ? 200 : 100 });
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
    fromClosing: r.closingId !== null,
    edits: r.edits.map((e) => ({
      previousDelta: e.previousDelta,
      newDelta: e.newDelta,
      editedByName: e.editedByName,
      when: when.format(e.editedAt),
    })),
  }));
  // Grouped by the day each movement belongs to (a rendición loaded the next morning sits on the day it closes).
  const days: { date: string; movements: MovementView[] }[] = [];
  for (const v of views) {
    const last = days.at(-1);
    if (last?.date === v.businessDate) last.movements.push(v);
    else days.push({ date: v.businessDate, movements: [v] });
  }
  const filtered = raw !== undefined || day !== undefined;
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-extrabold text-brand-600">Historial</h1>
        {filtered ? (
          <Link href="/admin/stock/historial" className={buttonClass("secondary")}>
            Ver todos
          </Link>
        ) : null}
      </div>
      <p className="text-sm text-ink-muted">
        Últimos movimientos por día. Las ventas y devoluciones se registran solas y no se editan. Lo cargado en una rendición figura en el día rendido, con la hora
        en que se cargó.
      </p>
      <Form action="/admin/stock/historial" className="flex max-w-xl flex-wrap items-end gap-3">
        {raw !== undefined ? <input type="hidden" name="item" value={raw} /> : null}
        <div className="min-w-48 flex-1">
          <Field label="Ver un día" htmlFor="dia">
            <Input id="dia" name="dia" type="date" required max={buenosAiresToday(new Date())} defaultValue={day ?? ""} className="min-h-11" />
          </Field>
        </div>
        <Button type="submit" variant="secondary">
          Ver
        </Button>
      </Form>
      {views.length === 0 ? (
        <Card>
          <p className="text-ink-muted">{day !== undefined ? "No hay movimientos ese día." : "Todavía no hay movimientos."}</p>
        </Card>
      ) : (
        days.map((d) => (
          <section key={d.date} aria-labelledby={`dia-${d.date}`} className="flex flex-col gap-3">
            <h2 id={`dia-${d.date}`} className="font-display text-lg font-bold first-letter:uppercase">
              {longDay(d.date)}
            </h2>
            <ul aria-label={`Movimientos del ${longDay(d.date)}`} className="grid gap-3 md:grid-cols-2">
              {d.movements.map((m) => (
                <MovementCard key={m.id} m={m} />
              ))}
            </ul>
          </section>
        ))
      )}
    </section>
  );
}
