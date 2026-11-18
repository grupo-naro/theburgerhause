"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { parsePesosToCents } from "@/lib/rendicion/parse-pesos";
import type { StockActionState } from "@/lib/stock/form";
import { UNIT_LABEL } from "@/lib/stock/labels";
import { formatPurchaseMoney, purchaseTotal } from "@/lib/stock/purchase-math";
import { formatQuantity, parseQuantity, type Unit } from "@/lib/stock/quantity";
import { registerIngresoAction } from "../actions";

type Option = { id: number; name: string; unit: Unit; kind: string; quantity: number };

/**
 * "Reponer stock". The key is fixed per load; it changes only after a successful save, so a double tap is ONE ingreso.
 * `showPrice` (admin only) adds the optional unit price and the live total.
 */
export function IngresoForm({
  items,
  initialItemId,
  initialKey,
  showPrice = false,
}: {
  items: Option[];
  initialItemId: number | null;
  initialKey: string;
  showPrice?: boolean;
}) {
  const [key, setKey] = useState(initialKey);
  const [itemId, setItemId] = useState(initialItemId === null ? "" : String(initialItemId));
  const [qtyText, setQtyText] = useState("");
  const [priceText, setPriceText] = useState("");
  const [state, action, pending] = useActionState<StockActionState, FormData>(async (prev, fd) => {
    const next = await registerIngresoAction(prev, fd);
    if (next.message) {
      setKey(crypto.randomUUID());
      setQtyText("");
      setPriceText("");
    }
    return next;
  }, {});
  const fe = state.fieldErrors ?? {};
  const item = items.find((i) => String(i.id) === itemId);
  const total = (() => {
    if (!showPrice || !item) return null;
    const qty = parseQuantity(qtyText, item.unit);
    const price = parsePesosToCents(priceText);
    if (!qty.ok || !price.ok || price.cents <= 0) return null;
    return purchaseTotal(qty.milli, price.cents);
  })();
  return (
    <form key={key} action={action} className="flex max-w-xl flex-col gap-4">
      <input type="hidden" name="idempotencyKey" value={key} />
      <FormMessage>{state.error}</FormMessage>
      <FormMessage tone="success">{state.message}</FormMessage>
      <Field label="Artículo" htmlFor="itemId" error={fe.itemId}>
        <Select id="itemId" name="itemId" required value={itemId} onChange={(e) => setItemId(e.target.value)} error={fe.itemId}>
          <option value="" disabled>
            Elegí un artículo
          </option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name} ({i.unit})
            </option>
          ))}
        </Select>
      </Field>
      {item ? (
        <p className="text-sm text-ink-muted">
          Hay {formatQuantity(item.quantity, item.unit)}.{" "}
          {item.kind === "bebida" ? "Si estaba agotada, vuelve a venderse apenas cargues el ingreso." : null}
        </p>
      ) : null}
      <Field
        label={item ? `Cantidad (${UNIT_LABEL[item.unit]})` : "Cantidad"}
        htmlFor="qty"
        hint={item?.unit === "u" ? "Números enteros." : "Podés usar coma: 12,5"}
        error={fe.qty}
      >
        <Input
          id="qty"
          name="qty"
          type="text"
          inputMode={item?.unit === "u" ? "numeric" : "decimal"}
          autoComplete="off"
          required
          defaultValue={state.values?.qty ?? ""}
          onChange={(e) => setQtyText(e.target.value)}
          hasHint
          error={fe.qty}
        />
      </Field>
      {showPrice ? (
        <Field
          label="Precio unitario (opcional)"
          htmlFor="unitPrice"
          hint={item ? `Por ${UNIT_LABEL[item.unit]}. Ej: 2.000` : "Ej: 2.000"}
          error={fe.unitPrice}
        >
          <Input
            id="unitPrice"
            name="unitPrice"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            defaultValue={state.values?.unitPrice ?? ""}
            onChange={(e) => setPriceText(e.target.value)}
            hasHint
            error={fe.unitPrice}
          />
        </Field>
      ) : null}
      {total !== null ? (
        <p data-testid="purchase-total" className="text-lg font-bold">
          Total: {formatPurchaseMoney(total)}
        </p>
      ) : null}
      <Field label="Nota (opcional)" htmlFor="note" hint="Por ejemplo: proveedor o remito." error={fe.note}>
        <Input id="note" name="note" maxLength={200} defaultValue={state.values?.note ?? ""} hasHint error={fe.note} />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Cargando…" : "Cargar ingreso"}
      </Button>
    </form>
  );
}
