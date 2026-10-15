"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import type { ActionState } from "@/lib/menu/action-state";
import { saveCadetAction } from "../actions";

type Initial = { id?: number; name: string; phone: string; active: boolean };

/** `otherActiveNames`: names of the OTHER active cadets, for the soft duplicate-name warning. */
export function CadetForm({ initial, otherActiveNames }: { initial: Initial; otherActiveNames: string[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveCadetAction, {});
  const fe = state.fieldErrors ?? {};
  const v = state.values;
  const [name, setName] = useState(initial.name);
  const clash = name.trim() !== "" && otherActiveNames.some((n) => n.toLowerCase() === name.trim().toLowerCase());
  return (
    <form action={action} className="flex max-w-xl flex-col gap-4">
      {initial.id !== undefined ? <input type="hidden" name="id" value={initial.id} /> : null}
      <FormMessage>{state.error}</FormMessage>
      <Field label="Nombre" htmlFor="name" error={fe.name}>
        <Input
          id="name"
          name="name"
          required
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={fe.name}
        />
      </Field>
      {clash ? (
        <p role="status" className="rounded-xl border border-cheddar-400 bg-cheddar-400/20 px-4 py-2 text-sm">
          Ya hay un cadete activo con ese nombre. Podés guardarlo igual si son personas distintas.
        </p>
      ) : null}
      <Field label="Teléfono" htmlFor="phone" hint="Opcional. Números, espacios, + - y paréntesis." error={fe.phone}>
        <Input
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          maxLength={30}
          defaultValue={v?.phone ?? initial.phone}
          hasHint
          error={fe.phone}
        />
      </Field>
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          name="active"
          defaultChecked={v ? "active" in v : initial.active}
          className="size-4 accent-brand-600"
        />
        Cadete activo (se puede asignar a pedidos)
      </label>
      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : "Guardar"}
        </Button>
        <Link href="/admin/cadetes" className={buttonClass("secondary")}>
          Cancelar
        </Link>
      </div>
    </form>
  );
}
