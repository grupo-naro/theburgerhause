"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import type { StockActionState } from "@/lib/stock/form";
import { KIND_LABEL, UNIT_LABEL } from "@/lib/stock/labels";
import { STOCK_KINDS, STOCK_UNITS, type Kind, type Unit } from "@/lib/stock/quantity";
import { createStockItemAction, updateStockItemAction } from "../actions";

type Initial = { id?: number; name: string; kind: Kind; unit: Unit; minQty: string; active: boolean };

/** Create (kind and unit are chosen) or edit (they are fixed: the ledger is in that unit). */
export function ItemForm({ initial }: { initial: Initial }) {
  const editing = initial.id !== undefined;
  const [state, action, pending] = useActionState<StockActionState, FormData>(editing ? updateStockItemAction : createStockItemAction, {});
  const fe = state.fieldErrors ?? {};
  const v = state.values;
  return (
    <form action={action} className="flex max-w-xl flex-col gap-4">
      {editing ? <input type="hidden" name="id" value={initial.id} /> : null}
      <FormMessage>{state.error}</FormMessage>
      <Field label="Nombre" htmlFor="name" error={fe.name}>
        <Input id="name" name="name" required maxLength={60} defaultValue={v?.name ?? initial.name} error={fe.name} />
      </Field>
      {editing ? (
        <p className="text-sm text-ink-muted">
          {KIND_LABEL[initial.kind]} · {UNIT_LABEL[initial.unit]}. El tipo y la unidad no se pueden cambiar.
        </p>
      ) : (
        <>
          <Field label="Tipo" htmlFor="kind" error={fe.kind}>
            <Select id="kind" name="kind" required defaultValue={v?.kind ?? initial.kind} error={fe.kind}>
              {STOCK_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Unidad" htmlFor="unit" error={fe.unit}>
            <Select id="unit" name="unit" required defaultValue={v?.unit ?? initial.unit} error={fe.unit}>
              {STOCK_UNITS.map((u) => (
                <option key={u} value={u}>
                  {UNIT_LABEL[u]}
                </option>
              ))}
            </Select>
          </Field>
        </>
      )}
      <Field
        label="Mínimo (aviso de Poco)"
        htmlFor="minQty"
        hint="Opcional. Con menos que esto el artículo figura como Poco. Podés usar coma: 2,5"
        error={fe.minQty}
      >
        <Input
          id="minQty"
          name="minQty"
          type="text"
          inputMode={initial.unit === "u" ? "numeric" : "decimal"}
          autoComplete="off"
          defaultValue={v?.minQty ?? initial.minQty}
          hasHint
          error={fe.minQty}
        />
      </Field>
      {editing ? (
        <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
          <input type="checkbox" name="active" defaultChecked={v ? "active" in v : initial.active} className="size-5 accent-brand-600" />
          Artículo activo (si lo das de baja, deja de controlar la venta)
        </label>
      ) : null}
      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : editing ? "Guardar" : "Crear artículo"}
        </Button>
        <Link href="/admin/stock/articulos" className={buttonClass("secondary")}>
          Cancelar
        </Link>
      </div>
    </form>
  );
}
