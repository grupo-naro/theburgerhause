"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import type { ActionState } from "@/lib/menu/action-state";
import { saveUserAction } from "../actions";
import { ROLE_LABEL, ROLES } from "./role-label";

type Initial = { id?: number; name: string; username: string; role: (typeof ROLES)[number]; active: boolean };

export function UserForm({ initial }: { initial: Initial }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveUserAction, {});
  const fe = state.fieldErrors ?? {};
  const v = state.values;
  const editing = initial.id !== undefined;
  return (
    <form action={action} className="flex max-w-xl flex-col gap-4">
      {editing ? <input type="hidden" name="id" value={initial.id} /> : null}
      <FormMessage>{state.error}</FormMessage>
      <Field label="Nombre" htmlFor="name" error={fe.name}>
        <Input id="name" name="name" required maxLength={80} defaultValue={v?.name ?? initial.name} error={fe.name} />
      </Field>
      <Field
        label="Usuario"
        htmlFor="username"
        hint="3 a 40 caracteres: letras, números, punto, guion y guion bajo. Se guarda en minúsculas."
        error={fe.username}
      >
        <Input
          id="username"
          name="username"
          required
          minLength={3}
          maxLength={40}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          defaultValue={v?.username ?? initial.username}
          hasHint
          error={fe.username}
        />
      </Field>
      <Field label="Rol" htmlFor="role" error={fe.role}>
        <Select id="role" name="role" defaultValue={v?.role ?? initial.role} error={fe.role}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label={editing ? "Nueva contraseña" : "Contraseña"}
        htmlFor="password"
        hint={
          editing
            ? "Dejala en blanco para no cambiarla. Si la cambiás, se cierran todas sus sesiones."
            : "Mínimo 8 caracteres."
        }
        error={fe.password}
      >
        <Input
          id="password"
          name="password"
          type="password"
          required={!editing}
          minLength={8}
          maxLength={256}
          autoComplete="new-password"
          hasHint
          error={fe.password}
        />
      </Field>
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          name="active"
          defaultChecked={v ? "active" in v : initial.active}
          className="size-4 accent-brand-600"
        />
        Usuario activo (puede iniciar sesión)
      </label>
      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : "Guardar"}
        </Button>
        <Link href="/admin/usuarios" className={buttonClass("secondary")}>
          Cancelar
        </Link>
      </div>
    </form>
  );
}
