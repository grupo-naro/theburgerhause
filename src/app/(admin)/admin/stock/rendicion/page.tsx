import { randomUUID } from "node:crypto";
import Form from "next/form";
import Link from "next/link";
import { Button, buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { getDb } from "@/db/client";
import { requireSessionOrRedirect } from "@/lib/auth/guards";
import { buenosAiresToday, longDay, shiftDate } from "@/lib/stock/closing-dates";
import { listClosedDates, listClosings, type ClosingView } from "@/lib/stock/closings";
import { formatQuantity } from "@/lib/stock/quantity";
import { listStockItems } from "@/lib/stock/queries";
import { businessDateSchema } from "@/lib/stock/schemas";
import { RendicionForm } from "../_components/rendicion-form";

export const metadata = { title: "Rendición de materia prima · Administración" };

/** How far back the date picker flags closed days (older ones are still refused by the server). */
const PICKER_DAYS = 400;

const closedAtFormat = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "America/Argentina/Buenos_Aires",
});

function ClosingCard({ c }: { c: ClosingView }) {
  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4" aria-label={`Rendición del ${longDay(c.businessDate)}`}>
      <div>
        <h3 className="font-display text-lg font-bold first-letter:uppercase">{longDay(c.businessDate)}</h3>
        <p className="text-sm text-ink-muted">
          Cerrada por {c.closedByName ?? "—"} el {closedAtFormat.format(c.closedAt)}
        </p>
      </div>
      {c.lines.length === 0 ? (
        <p className="text-sm text-ink-muted">Sin cantidades: todo se corrigió a cero en el Historial.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-ink-muted">
            <tr>
              <th scope="col" className="py-1 font-medium">
                Artículo
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Cantidad
              </th>
              <th scope="col" className="py-1 pl-2 font-medium">
                Unidad
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {c.lines.map((l) => (
              <tr key={l.itemId}>
                <td className="py-1.5 [overflow-wrap:anywhere]">{l.name}</td>
                <td className="py-1.5 text-right font-semibold whitespace-nowrap">{formatQuantity(l.milli, l.unit).replace(/ \S+$/, "")}</td>
                <td className="py-1.5 pl-2">{l.unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Link href={`/admin/stock/historial?dia=${c.businessDate}`} className={buttonClass("secondary")}>
        Corregir en el Historial
      </Link>
    </li>
  );
}

export default async function RendicionPage({ searchParams }: PageProps<"/admin/stock/rendicion">) {
  const sp = await searchParams;
  await requireSessionOrRedirect(["admin", "encargado"], "/admin/stock/rendicion");
  const db = getDb();
  const today = buenosAiresToday(new Date());
  // Untrusted query param: a malformed date just shows the latest closings.
  const day = typeof sp.dia === "string" && businessDateSchema.safeParse(sp.dia).success ? sp.dia : undefined;
  const [items, closedDates, closings] = await Promise.all([
    listStockItems(db),
    listClosedDates(db, shiftDate(today, PICKER_DAYS)),
    listClosings(db, day !== undefined ? { date: day } : {}),
  ]);
  const lines = items.filter((i) => i.active && i.kind === "materia_prima").map((i) => ({ id: i.id, name: i.name, unit: i.unit, quantity: i.quantity }));

  return (
    <section className="flex flex-col gap-5">
      <h1 className="font-display text-3xl font-extrabold text-brand-600">Rendición de materia prima</h1>
      <p className="text-sm text-ink-muted">
        Al terminar el día, cargá cuánto se usó de cada artículo y cerrá el día. Dejá en blanco lo que no se usó. Si lo cargás a la mañana siguiente, elegí la
        fecha de ayer.
      </p>

      <section aria-labelledby="cerrar-dia" className="flex flex-col gap-3">
        <h2 id="cerrar-dia" className="font-display text-xl font-bold">
          Cerrar un día
        </h2>
        {lines.length === 0 ? (
          <Card>
            <p className="text-ink-muted">No hay artículos de materia prima activos. Crealos en Artículos.</p>
          </Card>
        ) : (
          <RendicionForm lines={lines} today={today} closedDates={closedDates} initialKey={randomUUID()} />
        )}
      </section>

      <section aria-labelledby="cerradas" className="flex flex-col gap-3">
        <h2 id="cerradas" className="font-display text-xl font-bold">
          Rendiciones cerradas
        </h2>
        <Form action="/admin/stock/rendicion" className="flex max-w-xl flex-wrap items-end gap-3">
          <div className="min-w-48 flex-1">
            <Field label="Ver un día" htmlFor="dia">
              <Input id="dia" name="dia" type="date" required max={today} defaultValue={day ?? ""} className="min-h-11" />
            </Field>
          </div>
          <Button type="submit" variant="secondary">
            Ver
          </Button>
          {day !== undefined ? (
            <Link href="/admin/stock/rendicion" className={buttonClass("ghost")}>
              Ver las últimas
            </Link>
          ) : null}
        </Form>
        {closings.length === 0 ? (
          <Card>
            <p className="text-ink-muted">{day !== undefined ? "No hay rendición cerrada ese día." : "Todavía no se cerró ninguna rendición."}</p>
          </Card>
        ) : (
          <ul aria-label="Rendiciones" className="grid gap-3 md:grid-cols-2">
            {closings.map((c) => (
              <ClosingCard key={c.id} c={c} />
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
