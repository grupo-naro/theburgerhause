"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import type { ActionState } from "@/lib/menu/action-state";
import { unlockAnalyticsAction } from "../actions";

/** Locked state: PIN input (or a link to Ajustes when no PIN exists yet). */
export function PinGate({ hasPin }: { hasPin: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(unlockAnalyticsAction, {});
  return (
    <Card className="flex flex-col items-center gap-3 border-dashed border-brand-300 text-center">
      <p className="font-semibold">🔒 Los números están ocultos</p>
      {hasPin ? (
        <form action={action} className="flex flex-col items-center gap-3">
          <FormMessage>{state.error}</FormMessage>
          <label htmlFor="analytics-pin" className="text-sm text-ink-muted">
            Ingresá el PIN para verlos durante 15 minutos
          </label>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Input
              id="analytics-pin"
              name="pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              required
              aria-label="PIN"
              className="w-32 text-center tracking-[0.4em]"
            />
            <Button type="submit" disabled={pending}>
              {pending ? "Verificando…" : "Desbloquear"}
            </Button>
          </div>
        </form>
      ) : (
        <Link href="/admin/ajustes" className="font-semibold text-brand-600 underline">
          Configurá el PIN en Ajustes
        </Link>
      )}
    </Card>
  );
}
