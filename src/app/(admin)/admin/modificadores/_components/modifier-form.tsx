"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import type { ActionState } from "@/lib/menu/action-state";
import { normalizeKitchenLabel, type ModifierKind } from "@/lib/modifiers/kitchen-label";
import { saveModifierAction } from "../actions";
import { KIND_LABEL } from "./kind-label";

export type ModifierFormValues = {
  id?: number;
  groupId: number | null;
  name: string;
  kind: ModifierKind;
  priceArs: number;
  /** Explicit label as stored; the preview shows what the kitchen will print. */
  kitchenLabel: string;
  active: boolean;
};

const isKind = (v: string | undefined): v is ModifierKind => v === "remove" || v === "add" || v === "swap";

export function ModifierForm({
  initial,
  groups,
}: {
  initial: ModifierFormValues;
  groups: { id: number; name: string }[];
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveModifierAction, {});
  const v = state.values;
  const fe = state.fieldErrors ?? {};
  const [name, setName] = useState(v?.name ?? initial.name);
  const [kind, setKind] = useState<ModifierKind>(isKind(v?.kind) ? v.kind : initial.kind);
  const [label, setLabel] = useState(v?.kitchenLabel ?? initial.kitchenLabel);
  const [price, setPrice] = useState(v?.priceArs ?? String(initial.priceArs));
  const free = kind === "remove";
  const preview = normalizeKitchenLabel(name, kind, label);
  return (
    <form action={action} className="flex max-w-xl flex-col gap-4">
      {initial.id !== undefined ? <input type="hidden" name="id" value={initial.id} /> : null}
      <FormMessage>{state.error}</FormMessage>
      <Field label="Grupo" htmlFor="groupId" error={fe.groupId}>
        <Select
          id="groupId"
          name="groupId"
          required
          defaultValue={v?.groupId ?? (initial.groupId === null ? "" : String(initial.groupId))}
          error={fe.groupId}
        >
          <option value="" disabled>
            Elegí un grupo
          </option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Nombre" htmlFor="name" hint="Lo que ve el cliente. Ej: Sin cheddar, + Dips de cheddar." error={fe.name}>
        <Input
          id="name"
          name="name"
          required
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
          hasHint
          error={fe.name}
        />
      </Field>
      <Field label="Tipo" htmlFor="kind" error={fe.kind}>
        <Select
          id="kind"
          name="kind"
          value={kind}
          onChange={(e) => {
            const next = e.target.value as ModifierKind;
            setKind(next);
            if (next === "remove") setPrice("0");
          }}
          error={fe.kind}
        >
          {(Object.keys(KIND_LABEL) as ModifierKind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label="Precio (pesos)"
        htmlFor="priceArs"
        hint={free ? "Un quite no tiene precio." : "Pesos enteros, sin puntos ni comas. Ej: 1200"}
        error={fe.priceArs}
      >
        <Input
          id="priceArs"
          name="priceArs"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          required={!free}
          disabled={free}
          value={free ? "0" : price}
          onChange={(e) => setPrice(e.target.value)}
          hasHint
          error={fe.priceArs}
        />
      </Field>
      <Field
        label="Texto para cocina (opcional)"
        htmlFor="kitchenLabel"
        hint="Si lo dejás vacío se arma solo. Siempre se imprime en mayúsculas."
        error={fe.kitchenLabel}
      >
        <Input
          id="kitchenLabel"
          name="kitchenLabel"
          maxLength={60}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          hasHint
          error={fe.kitchenLabel}
        />
      </Field>
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">Así lo ve la cocina</span>
        <p
          data-testid="kitchen-preview"
          aria-live="polite"
          className="min-h-11 rounded-xl border border-dashed border-line bg-slate-50 px-4 py-2.5 font-mono text-base font-bold tracking-wide"
        >
          {preview || <span className="font-sans font-normal text-ink-muted">Escribí un nombre…</span>}
        </p>
      </div>
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          name="active"
          defaultChecked={v ? "active" in v : initial.active}
          className="size-4 accent-brand-600"
        />
        Modificador activo (se puede elegir)
      </label>
      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : "Guardar"}
        </Button>
        <Link href="/admin/modificadores" className={buttonClass("secondary")}>
          Cancelar
        </Link>
      </div>
    </form>
  );
}
