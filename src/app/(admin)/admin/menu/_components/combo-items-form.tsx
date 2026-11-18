"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormMessage } from "@/components/ui/form-message";
import { formatARS } from "@/domain/money";
import type { ActionState } from "@/lib/menu/action-state";
import { saveComboItemsAction } from "../actions";

type Option = { id: number; name: string; price: number };
type Row = { key: number; productId: number | ""; quantity: number };

/**
 * "Contenido del combo": a fixed list of products and quantities. Empty = a plain product. Shows what the contents
 * cost bought separately and the saving against the combo's own price.
 */
export function ComboItemsForm({
  comboId,
  comboPrice,
  options,
  initial,
}: {
  comboId: number;
  /** Centavos (the product's price). */
  comboPrice: number;
  /** Products that can go inside (never this product nor another combo). */
  options: Option[];
  initial: { productId: number; quantity: number }[];
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveComboItemsAction, {});
  const [rows, setRows] = useState<Row[]>(() => initial.map((r, i) => ({ key: i, productId: r.productId, quantity: r.quantity })));
  const [nextKey, setNextKey] = useState(initial.length);
  const [dirty, setDirty] = useState(false);
  const price = new Map(options.map((o) => [o.id, o.price]));
  const separate = rows.reduce((sum, r) => sum + (r.productId === "" ? 0 : (price.get(r.productId) ?? 0) * r.quantity), 0);

  const update = (key: number, patch: Partial<Row>) => {
    setDirty(true);
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  return (
    <Card className="flex max-w-xl flex-col gap-3">
      <h2 id="combo-title" className="font-display text-2xl font-extrabold">
        Contenido del combo
      </h2>
      <p className="text-sm text-ink-muted">
        Si agregás productos, este producto pasa a ser un combo: se vende a su precio y la cocina recibe el detalle. Vacío = producto común.
      </p>
      <form action={action} onSubmit={() => setDirty(false)} aria-labelledby="combo-title" className="flex flex-col gap-3">
        <input type="hidden" name="comboId" value={comboId} />
        <FormMessage>{state.error}</FormMessage>
        <FormMessage tone="success">{dirty ? null : state.message}</FormMessage>
        {rows.map((r) => (
          <div key={r.key} data-testid="combo-row" className="flex flex-wrap items-center gap-2">
            <select
              name="productId"
              aria-label="Producto"
              required
              value={r.productId === "" ? "" : String(r.productId)}
              onChange={(e) => update(r.key, { productId: e.target.value === "" ? "" : Number(e.target.value) })}
              className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3"
            >
              <option value="" disabled>
                Elegí un producto
              </option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <input
              name="quantity"
              aria-label="Cantidad"
              type="number"
              min={1}
              max={20}
              required
              value={r.quantity}
              onChange={(e) => update(r.key, { quantity: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })}
              className="min-h-11 w-20 rounded-xl border border-line bg-surface px-3 text-center"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setDirty(true);
                setRows((prev) => prev.filter((x) => x.key !== r.key));
              }}
            >
              Quitar
            </Button>
          </div>
        ))}
        <div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              setDirty(true);
              setRows((prev) => [...prev, { key: nextKey, productId: "", quantity: 1 }]);
              setNextKey((k) => k + 1);
            }}
          >
            Agregar producto
          </Button>
        </div>
        {rows.length > 0 ? (
          <p data-testid="combo-saving" className="text-sm">
            Por separado: <strong>{formatARS(separate)}</strong> · Precio del combo: <strong>{formatARS(comboPrice)}</strong> ·{" "}
            {separate > comboPrice ? (
              <span className="font-semibold text-green-700">Ahorro: {formatARS(separate - comboPrice)}</span>
            ) : (
              <span className="text-ink-muted">Sin ahorro</span>
            )}
          </p>
        ) : null}
        {dirty ? <p className="text-sm font-semibold text-ink-muted">Hay cambios sin guardar</p> : null}
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? "Guardando…" : "Guardar contenido"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
