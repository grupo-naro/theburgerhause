"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import type { StockActionState } from "@/lib/stock/form";
import { formatQuantity, type Unit } from "@/lib/stock/quantity";
import { registerConsumoAction } from "../actions";

type Line = { id: number; name: string; unit: Unit; quantity: number };

/**
 * "Consumo del día": one field per item, blank = nothing consumed. The idempotency key is fixed
 * per load and only changes after a successful save, so a double tap writes ONE consumo.
 */
export function ConsumoForm({ lines, today, initialKey }: { lines: Line[]; today: string; initialKey: string }) {
  const [key, setKey] = useState(initialKey);
  const [state, action, pending] = useActionState<StockActionState, FormData>(async (prev, fd) => {
    const next = await registerConsumoAction(prev, fd);
    if (next.message) setKey(crypto.randomUUID());
    return next;
  }, {});
  const fe = state.fieldErrors ?? {};
  return (
    <form key={key} action={action} className="flex max-w-xl flex-col gap-4">
      <input type="hidden" name="idempotencyKey" value={key} />
      <FormMessage>{state.error}</FormMessage>
      <FormMessage tone="success">{state.message}</FormMessage>
      <Field label="Fecha" htmlFor="businessDate" error={fe.businessDate}>
        <Input
          id="businessDate"
          name="businessDate"
          type="date"
          required
          max={today}
          defaultValue={state.values?.businessDate ?? today}
          error={fe.businessDate}
        />
      </Field>
      <ul aria-label="Artículos" className="flex flex-col gap-3">
        {lines.map((l) => {
          const name = `q_${l.id}`;
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
                  hasHint
                  error={fe[name]}
                />
              </Field>
            </li>
          );
        })}
      </ul>
      {state.needsConfirm ? (
        <Button type="submit" name="confirmNegative" value="true" variant="danger" disabled={pending}>
          Guardar igual
        </Button>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Guardando…" : "Guardar consumo"}
      </Button>
    </form>
  );
}
