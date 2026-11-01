"use client";

import { useActionState, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { closingDateProblem, longDay } from "@/lib/stock/closing-dates";
import { parseOptionalQuantity, type StockActionState } from "@/lib/stock/form";
import { formatQuantity, type Unit } from "@/lib/stock/quantity";
import { closeStockDayAction } from "../actions";

type Line = { id: number; name: string; unit: Unit; quantity: number };
type Summary = { date: string; lines: { id: number; name: string; amount: string }[] };

const field = (id: number) => `q_${id}`;
const NOTHING_TO_SAVE = "Cargá al menos una cantidad";

/**
 * "Cerrar el día": one field per raw material (blank = not used) and the date to close (today by
 * default, any earlier day not closed yet). "Cerrar el día" first shows a summary of what will be
 * saved; "Confirmar cierre" sends it. The idempotency key is fixed per load and only changes after
 * a successful closing, so a double tap closes the day ONCE.
 */
export function RendicionForm({ lines, today, closedDates, initialKey }: { lines: Line[]; today: string; closedDates: string[]; initialKey: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const [key, setKey] = useState(initialKey);
  const [date, setDate] = useState(today);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [local, setLocal] = useState<{ error?: string; fieldErrors?: Record<string, string> }>({});
  // The last server answer is hidden once the person moves on (new summary or another date), until the next one.
  const [stale, setStale] = useState(false);
  const [state, action, pending] = useActionState<StockActionState, FormData>(async (prev, fd) => {
    const next = await closeStockDayAction(prev, fd);
    setStale(false);
    if (next.message) {
      setKey(crypto.randomUUID());
      setDate(today);
    }
    if (!next.needsConfirm) setSummary(null);
    return next;
  }, {});

  const closed = new Set(closedDates);
  const dateProblem = date === "" ? "Elegí la fecha a rendir" : closingDateProblem(date, today, closed);
  const server: StockActionState = stale ? {} : state;
  const fe = { ...(server.fieldErrors ?? {}), ...(local.fieldErrors ?? {}) };
  const recentClosed = closedDates.slice(0, 4).map(longDay);

  function openSummary() {
    const fd = new FormData(formRef.current!);
    const fieldErrors: Record<string, string> = {};
    const chosen: Summary["lines"] = [];
    for (const l of lines) {
      const raw = fd.get(field(l.id));
      const parsed = parseOptionalQuantity(typeof raw === "string" ? raw : "", l.unit);
      if (!parsed.ok) fieldErrors[field(l.id)] = parsed.message;
      else if (parsed.milli > 0) chosen.push({ id: l.id, name: l.name, amount: formatQuantity(parsed.milli, l.unit) });
    }
    if (Object.keys(fieldErrors).length > 0) return setLocal({ error: "Revisá las cantidades marcadas.", fieldErrors });
    if (chosen.length === 0) return setLocal({ error: NOTHING_TO_SAVE });
    setLocal({});
    setStale(true);
    setSummary({ date, lines: chosen });
    requestAnimationFrame(() => summaryRef.current?.scrollIntoView({ block: "center" }));
  }

  return (
    <form key={key} ref={formRef} action={action} className="flex max-w-xl flex-col gap-4">
      <input type="hidden" name="idempotencyKey" value={key} />
      <FormMessage>{local.error ?? server.error}</FormMessage>
      <FormMessage tone="success">{local.error ? undefined : server.message}</FormMessage>
      <Field label="Fecha a rendir" htmlFor="businessDate" hint={recentClosed.length > 0 ? `Ya cerradas: ${recentClosed.join(", ")}` : undefined} error={dateProblem ?? fe.businessDate}>
        <div className="flex items-center gap-3">
          <Input
            id="businessDate"
            name="businessDate"
            type="date"
            required
            max={today}
            value={date}
            readOnly={summary !== null}
            onChange={(e) => {
              setDate(e.target.value);
              setLocal({});
              setStale(true);
            }}
            hasHint={recentClosed.length > 0}
            error={dateProblem ?? fe.businessDate}
            className="min-h-11 flex-1"
          />
          {closed.has(date) ? <Badge>Ya cerrada</Badge> : null}
        </div>
      </Field>
      <ul aria-label="Materia prima" className="flex flex-col gap-3">
        {lines.map((l) => {
          const name = field(l.id);
          return (
            <li key={l.id} className="rounded-2xl border border-line bg-surface p-3">
              <Field label={`${l.name} (${l.unit})`} htmlFor={name} hint={`Hay ${formatQuantity(l.quantity, l.unit)}`} error={fe[name]}>
                <Input
                  id={name}
                  name={name}
                  type="text"
                  inputMode={l.unit === "u" ? "numeric" : "decimal"}
                  autoComplete="off"
                  placeholder="0"
                  defaultValue={state.values?.[name] ?? ""}
                  readOnly={summary !== null}
                  hasHint
                  error={fe[name]}
                />
              </Field>
            </li>
          );
        })}
      </ul>
      {summary ? (
        <section
          ref={summaryRef}
          aria-labelledby="rendicion-summary"
          className="flex flex-col gap-3 rounded-2xl border-2 border-brand-600 bg-brand-50 p-4"
        >
          <h2 id="rendicion-summary" className="font-display text-lg font-bold">
            Vas a cerrar el {longDay(summary.date)}
          </h2>
          <ul aria-label="Resumen" className="flex flex-col divide-y divide-line">
            {summary.lines.map((l) => (
              <li key={l.id} className="flex justify-between gap-3 py-1.5">
                <span className="[overflow-wrap:anywhere]">{l.name}</span>
                <span className="font-semibold whitespace-nowrap">{l.amount}</span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-ink-muted">Cada día se cierra una sola vez. Después, las correcciones se hacen desde el Historial.</p>
          {server.needsConfirm ? (
            <Button type="submit" name="confirmNegative" value="true" variant="danger" disabled={pending}>
              Guardar igual
            </Button>
          ) : (
            <Button type="submit" disabled={pending}>
              {pending ? "Cerrando…" : "Confirmar cierre"}
            </Button>
          )}
          <Button type="button" variant="secondary" disabled={pending} onClick={() => setSummary(null)}>
            Volver a editar
          </Button>
        </section>
      ) : (
        <Button type="button" disabled={dateProblem !== null} onClick={openSummary}>
          Cerrar el día
        </Button>
      )}
    </form>
  );
}
