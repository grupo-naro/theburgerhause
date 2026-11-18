"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormMessage } from "@/components/ui/form-message";
import type { ActionState } from "@/lib/menu/action-state";
import type { GroupProductsView } from "@/lib/modifiers/admin";
import { saveGroupProductsAction } from "../actions";

/** "Productos que lo ofrecen": check the products (or whole categories) that offer this group, then save once. */
export function GroupProductsForm({ groupId, view }: { groupId: number; view: GroupProductsView }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveGroupProductsAction, {});
  const [checked, setChecked] = useState<Set<number>>(() => new Set(view.flatMap((c) => c.products.filter((p) => p.checked).map((p) => p.id))));

  const toggle = (id: number) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const setCategory = (ids: number[], on: boolean) =>
    setChecked((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  return (
    <Card className="flex max-w-3xl flex-col gap-4">
      <h2 id="group-products-title" className="font-display text-2xl font-extrabold">
        Productos que lo ofrecen
      </h2>
      <form action={action} aria-labelledby="group-products-title" className="flex flex-col gap-4">
        <input type="hidden" name="groupId" value={groupId} />
        {[...checked].map((id) => (
          <input key={id} type="hidden" name="productId" value={id} />
        ))}
        <FormMessage>{state.error}</FormMessage>
        <FormMessage tone="success">{state.message}</FormMessage>
        {view
          .filter((c) => c.products.length > 0)
          .map((c) => {
            const ids = c.products.map((p) => p.id);
            const all = ids.every((id) => checked.has(id));
            return (
              <fieldset key={c.categoryId} data-testid="group-category" className="flex flex-col gap-2 border-t border-line pt-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <legend className="font-semibold">{c.categoryName}</legend>
                  <Button type="button" variant="secondary" size="sm" onClick={() => setCategory(ids, !all)}>
                    {all ? "Desmarcar toda la categoría" : "Marcar toda la categoría"}
                  </Button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {c.products.map((p) => (
                    <label key={p.id} className="flex min-h-11 items-center gap-3 rounded-xl border border-line px-3">
                      <input type="checkbox" className="size-5" checked={checked.has(p.id)} onChange={() => toggle(p.id)} />
                      <span>
                        {p.name}
                        {p.active ? "" : " (pausado)"}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            );
          })}
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
