"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import type { StockActionState } from "@/lib/stock/form";
import { setPurchasePriceAction } from "../actions";

/** "Editar precio" / "Agregar precio" of one ingreso (admin). Blank clears the price. */
export function PurchasePriceForm({
  movementId,
  initialPrice,
  openLabel,
  context,
}: {
  movementId: number;
  /** What the input shows when opened ("2.400"), "" when there is no price. */
  initialPrice: string;
  openLabel: string;
  /** Accessible context for the toggle, e.g. "del 18/11/26". */
  context: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<StockActionState, FormData>(async (prev, fd) => {
    const next = await setPurchasePriceAction(prev, fd);
    if (next.message) setOpen(false);
    return next;
  }, {});
  const fe = state.fieldErrors ?? {};
  if (!open) {
    return (
      <Button type="button" variant="secondary" aria-label={`${openLabel} ${context}`} onClick={() => setOpen(true)}>
        {openLabel}
      </Button>
    );
  }
  const id = `unitPrice-${movementId}`;
  return (
    <form action={action} className="flex flex-col gap-3 border-t border-line pt-3">
      <input type="hidden" name="movementId" value={movementId} />
      <FormMessage>{state.error}</FormMessage>
      <Field label="Precio unitario" htmlFor={id} hint="Vacío quita el precio." error={fe.unitPrice}>
        <Input
          id={id}
          name="unitPrice"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          defaultValue={state.values?.unitPrice ?? initialPrice}
          hasHint
          error={fe.unitPrice}
        />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending} className="flex-1">
          {pending ? "Guardando…" : "Guardar precio"}
        </Button>
        <Button type="button" variant="secondary" className="flex-1" onClick={() => setOpen(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
