"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import type { StockActionState } from "@/lib/stock/form";
import { MOVEMENT_LABEL } from "@/lib/stock/labels";
import { formatQuantity, type Unit } from "@/lib/stock/quantity";
import { editMovementAction } from "../actions";

export type MovementView = {
  id: number;
  itemName: string;
  unit: Unit;
  kind: keyof typeof MOVEMENT_LABEL;
  qtyDelta: number;
  businessDate: string;
  when: string;
  note: string | null;
  userName: string | null;
  orderId: number | null;
  /** Written by a rendición de materia prima (dated to the day it closes). */
  fromClosing: boolean;
  edits: { previousDelta: number; newDelta: number; editedByName: string | null; when: string }[];
};

const EDITABLE = ["ajuste_inicial", "ingreso", "consumo"];

/** The amount as a person reads it: a consumo is shown as what was consumed, with its sign in the label. */
const amount = (kind: string, delta: number) => (kind === "consumo" ? -delta : delta);
const plain = (milli: number, unit: Unit) => formatQuantity(milli, unit).replace(/ \S+$/, "");

export function MovementCard({ m }: { m: MovementView }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<StockActionState, FormData>(async (prev, fd) => {
    const next = await editMovementAction(prev, fd);
    if (next.message) setOpen(false);
    return next;
  }, {});
  const fe = state.fieldErrors ?? {};
  const signed = `${m.qtyDelta > 0 ? "+" : ""}${formatQuantity(m.qtyDelta, m.unit)}`;
  const last = m.edits.at(-1);
  return (
    <li className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium [overflow-wrap:anywhere]">{m.itemName}</p>
          <p className="text-sm text-ink-muted">
            {MOVEMENT_LABEL[m.kind]}
            {m.fromClosing ? ` de la rendición · cargado ${m.when}` : ` · ${m.when}`}
          </p>
        </div>
        <p className="text-lg font-bold whitespace-nowrap">{signed}</p>
      </div>
      <p className="text-xs text-ink-muted">
        Día {m.businessDate}
        {m.userName ? ` · ${m.userName}` : ""}
        {m.orderId !== null ? ` · Pedido #${m.orderId}` : ""}
      </p>
      {m.note ? <p className="text-sm [overflow-wrap:anywhere]">Nota: {m.note}</p> : null}
      {last ? (
        <div className="text-xs text-ink-muted">
          <p>
            Valor anterior: {formatQuantity(amount(m.kind, last.previousDelta), m.unit)} (editado por {last.editedByName ?? "—"}, {last.when})
          </p>
          {m.edits.length > 1 ? <p>{m.edits.length} ediciones en total.</p> : null}
        </div>
      ) : null}
      {EDITABLE.includes(m.kind) ? (
        open ? (
          <form action={action} className="flex flex-col gap-3 border-t border-line pt-3">
            <input type="hidden" name="movementId" value={m.id} />
            <FormMessage>{state.error}</FormMessage>
            <Field label={`Nueva cantidad (${m.unit})`} htmlFor={`qty-${m.id}`} hint="0 anula el movimiento." error={fe.qty}>
              <Input
                id={`qty-${m.id}`}
                name="qty"
                type="text"
                inputMode={m.unit === "u" ? "numeric" : "decimal"}
                autoComplete="off"
                required
                defaultValue={state.values?.qty ?? plain(Math.abs(m.qtyDelta), m.unit)}
                hasHint
                error={fe.qty}
              />
            </Field>
            {state.needsConfirm ? (
              <Button type="submit" name="confirmNegative" value="true" variant="danger" disabled={pending}>
                Confirmar y guardar
              </Button>
            ) : null}
            <div className="flex gap-2">
              <Button type="submit" disabled={pending} className="flex-1">
                {pending ? "Guardando…" : "Guardar cambio"}
              </Button>
              <Button type="button" variant="secondary" className="flex-1" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
            </div>
          </form>
        ) : (
          <Button type="button" variant="secondary" aria-expanded={false} aria-label={`Editar ${MOVEMENT_LABEL[m.kind]} de ${m.itemName}`} onClick={() => setOpen(true)}>
            Editar
          </Button>
        )
      ) : null}
    </li>
  );
}
