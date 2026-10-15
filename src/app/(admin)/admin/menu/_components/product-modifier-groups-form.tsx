"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import type { ActionState } from "@/lib/menu/action-state";
import { saveProductModifierGroupsAction } from "../actions";

/** Own form + action, separate from the product form (which stays unchanged). */
export function ProductModifierGroupsForm({
  productId,
  groups,
  linkedIds,
}: {
  productId: number;
  groups: { id: number; name: string }[];
  linkedIds: number[];
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveProductModifierGroupsAction, {});
  const [checked, setChecked] = useState(() => new Set(linkedIds));
  const toggle = (id: number) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  return (
    <form action={action} aria-labelledby="modifier-groups-title" className="flex max-w-xl flex-col gap-3">
      <h2 id="modifier-groups-title" className="font-display text-2xl font-extrabold">
        Grupos de modificadores
      </h2>
      <input type="hidden" name="id" value={productId} />
      <FormMessage>{state.error}</FormMessage>
      <FormMessage tone="success">{state.message}</FormMessage>
      {groups.length === 0 ? (
        <p className="text-sm text-ink-muted">
          Todavía no hay grupos.{" "}
          <Link href="/admin/modificadores/grupos/nuevo" className="font-semibold text-brand-600 underline">
            Crear un grupo
          </Link>
        </p>
      ) : (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm text-ink-muted">
            Los que marques se ofrecen al cliente en la ficha de este producto.
          </legend>
          {groups.map((g) => (
            <label key={g.id} className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                name="groupId"
                value={g.id}
                checked={checked.has(g.id)}
                onChange={() => toggle(g.id)}
                className="size-4 accent-brand-600"
              />
              {g.name}
            </label>
          ))}
        </fieldset>
      )}
      <div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Guardando…" : "Actualizar grupos"}
        </Button>
      </div>
    </form>
  );
}
