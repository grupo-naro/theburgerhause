"use client";

import { useActionState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import type { ActionState } from "@/lib/menu/action-state";
import { setAnalyticsPinAction } from "../actions";

/** Store PIN that unlocks the analytics numbers. Fields are never prefilled (secrets are not echoed). */
export function AnalyticsPinForm({ hasPin }: { hasPin: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(setAnalyticsPinAction, {});
  const fe = state.fieldErrors ?? {};
  // React resets an uncontrolled <form action> after every submit: the secrets never stay in the inputs.

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-xl font-extrabold">PIN de analíticas</h2>
        <Badge tone={hasPin ? "success" : "warning"}>{hasPin ? "Configurado" : "Sin configurar"}</Badge>
      </div>
      <p className="text-sm text-ink-muted">
        Desbloquea los números de Analíticas por 15 minutos. Para cambiarlo te pedimos tu contraseña.
      </p>
      <form action={action} className="flex flex-col gap-4">
        <FormMessage>{state.error}</FormMessage>
        <FormMessage tone="success">{state.message}</FormMessage>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="PIN nuevo" htmlFor="pin" hint="De 4 a 6 números." error={fe.pin}>
            <Input id="pin" name="pin" type="password" inputMode="numeric" autoComplete="off" maxLength={6} hasHint error={fe.pin} />
          </Field>
          <Field label="Repetí el PIN" htmlFor="pinConfirm" error={fe.pinConfirm}>
            <Input id="pinConfirm" name="pinConfirm" type="password" inputMode="numeric" autoComplete="off" maxLength={6} error={fe.pinConfirm} />
          </Field>
          <Field label="Tu contraseña" htmlFor="pinPassword" error={fe.password}>
            <Input id="pinPassword" name="password" type="password" autoComplete="current-password" error={fe.password} />
          </Field>
        </div>
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? "Guardando…" : "Guardar PIN"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
