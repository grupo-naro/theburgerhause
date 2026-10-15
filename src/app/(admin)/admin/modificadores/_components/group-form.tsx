"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import type { ActionState } from "@/lib/menu/action-state";
import { saveModifierGroupAction } from "../actions";

export function GroupForm({ initial }: { initial: { id?: number; name: string } }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveModifierGroupAction, {});
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex max-w-xl flex-col gap-4">
      {initial.id !== undefined ? <input type="hidden" name="id" value={initial.id} /> : null}
      <FormMessage>{state.error}</FormMessage>
      <Field label="Nombre" htmlFor="name" hint="Ej: Quitar ingredientes, Agregados, Papas." error={fe.name}>
        <Input
          id="name"
          name="name"
          required
          maxLength={80}
          defaultValue={state.values?.name ?? initial.name}
          hasHint
          error={fe.name}
        />
      </Field>
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
