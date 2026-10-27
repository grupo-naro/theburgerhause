"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import type { StockActionState } from "@/lib/stock/form";
import type { Unit } from "@/lib/stock/quantity";
import { setInitialStockAction } from "../actions";

/** The starting balance, once per item (later corrections go through the history). */
export function InitialStockForm({ itemId, unit }: { itemId: number; unit: Unit }) {
  const [state, action, pending] = useActionState<StockActionState, FormData>(setInitialStockAction, {});
  const fe = state.fieldErrors ?? {};
  return (
    <Card>
      <form action={action} className="flex max-w-xl flex-col gap-3">
        <h2 className="font-display text-xl font-bold">Stock inicial</h2>
        <p className="text-sm text-ink-muted">Cargá lo que hay hoy. Se hace una sola vez; después se corrige desde el historial.</p>
        <input type="hidden" name="id" value={itemId} />
        <FormMessage>{state.error}</FormMessage>
        <Field label={`Cantidad inicial (${unit})`} htmlFor="initial-qty" hint="Podés dejar 0." error={fe.qty}>
          <Input
            id="initial-qty"
            name="qty"
            type="text"
            inputMode={unit === "u" ? "numeric" : "decimal"}
            autoComplete="off"
            defaultValue={state.values?.qty ?? ""}
            hasHint
            error={fe.qty}
          />
        </Field>
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : "Guardar stock inicial"}
        </Button>
      </form>
    </Card>
  );
}
