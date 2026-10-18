"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import type { ActionState } from "@/lib/menu/action-state";
import { saveSettingsAction } from "../actions";

export type SettingsFormValues = {
  storeName: string;
  storeAddress: string;
  storePhone: string;
  whatsapp: string;
  bankAlias: string;
  bankCbu: string;
  deliveryFeePesos: number;
  acceptingOrders: boolean;
  openingHoursText: string;
  businessDayCutoff: string;
  kdsWarnMinutes: number;
  kdsLateMinutes: number;
};

export function SettingsForm({ initial }: { initial: SettingsFormValues }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveSettingsAction, {});
  const fe = state.fieldErrors ?? {};
  const v = state.values;
  const pick = (key: keyof SettingsFormValues) => v?.[key] ?? String(initial[key]);

  // The quick toggle above the form changes `initial.acceptingOrders`: follow it.
  const [accepting, setAccepting] = useState(initial.acceptingOrders);
  const [seen, setSeen] = useState(initial.acceptingOrders);
  if (seen !== initial.acceptingOrders) {
    setSeen(initial.acceptingOrders);
    setAccepting(initial.acceptingOrders);
  }

  return (
    <form action={action} className="flex flex-col gap-5">
      <FormMessage>{state.error}</FormMessage>
      <FormMessage tone="success">{state.message}</FormMessage>

      <Card className="flex flex-col gap-4">
        <h2 className="font-display text-xl font-extrabold">Datos del local</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Nombre del local" htmlFor="storeName" error={fe.storeName}>
            <Input id="storeName" name="storeName" required maxLength={80} defaultValue={pick("storeName")} error={fe.storeName} />
          </Field>
          <Field label="Dirección" htmlFor="storeAddress" error={fe.storeAddress}>
            <Input id="storeAddress" name="storeAddress" maxLength={200} defaultValue={pick("storeAddress")} error={fe.storeAddress} />
          </Field>
          <Field label="Teléfono" htmlFor="storePhone" error={fe.storePhone}>
            <Input id="storePhone" name="storePhone" type="tel" inputMode="tel" maxLength={30} defaultValue={pick("storePhone")} error={fe.storePhone} />
          </Field>
          <Field
            label="WhatsApp"
            htmlFor="whatsapp"
            hint="Con código de país, sin espacios si es posible. Ej: 5491155551234"
            error={fe.whatsapp}
          >
            <Input id="whatsapp" name="whatsapp" type="tel" inputMode="tel" maxLength={30} defaultValue={pick("whatsapp")} hasHint error={fe.whatsapp} />
          </Field>
        </div>
        <Field label="Horarios" htmlFor="openingHoursText" hint="Texto libre que ve el cliente. Ej: Lun a Dom de 20 a 00." error={fe.openingHoursText}>
          <Textarea id="openingHoursText" name="openingHoursText" rows={3} maxLength={500} defaultValue={pick("openingHoursText")} hasHint error={fe.openingHoursText} />
        </Field>
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="font-display text-xl font-extrabold">Pago por transferencia</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Alias" htmlFor="bankAlias" hint="Letras, números, punto, guion y guion bajo." error={fe.bankAlias}>
            <Input id="bankAlias" name="bankAlias" maxLength={40} autoCapitalize="none" spellCheck={false} defaultValue={pick("bankAlias")} hasHint error={fe.bankAlias} />
          </Field>
          <Field label="CBU / CVU" htmlFor="bankCbu" hint="22 dígitos, sin espacios." error={fe.bankCbu}>
            <Input id="bankCbu" name="bankCbu" inputMode="numeric" maxLength={22} autoComplete="off" defaultValue={pick("bankCbu")} hasHint error={fe.bankCbu} />
          </Field>
        </div>
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="font-display text-xl font-extrabold">Envío y pedidos</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Costo de envío ($)" htmlFor="deliveryFeePesos" hint="En pesos enteros. 0 = envío sin cargo." error={fe.deliveryFeePesos}>
            <Input id="deliveryFeePesos" name="deliveryFeePesos" type="number" inputMode="numeric" required defaultValue={pick("deliveryFeePesos")} hasHint error={fe.deliveryFeePesos} />
          </Field>
          <Field
            label="Cierre del día de trabajo"
            htmlFor="businessDayCutoff"
            hint="Hora (Buenos Aires) en la que el número de pedido vuelve a 1. Antes de esa hora, las ventas cuentan como del día anterior. Ej: 06:00."
            error={fe.businessDayCutoff}
          >
            <Input id="businessDayCutoff" name="businessDayCutoff" type="time" required defaultValue={pick("businessDayCutoff")} hasHint error={fe.businessDayCutoff} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            name="acceptingOrders"
            checked={accepting}
            onChange={(e) => setAccepting(e.target.checked)}
            className="size-4 accent-brand-600"
          />
          Recibiendo pedidos online
        </label>
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="font-display text-xl font-extrabold">Pantalla de cocina</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Aviso amarillo (minutos)" htmlFor="kdsWarnMinutes" hint="Desde cuántos minutos en preparación el reloj del pedido se pone amarillo." error={fe.kdsWarnMinutes}>
            <Input id="kdsWarnMinutes" name="kdsWarnMinutes" type="number" inputMode="numeric" min={1} max={480} required defaultValue={pick("kdsWarnMinutes")} hasHint error={fe.kdsWarnMinutes} />
          </Field>
          <Field label="Aviso rojo (minutos)" htmlFor="kdsLateMinutes" hint="Desde cuántos minutos se pone rojo (pedido demorado). Tiene que ser mayor que el amarillo." error={fe.kdsLateMinutes}>
            <Input id="kdsLateMinutes" name="kdsLateMinutes" type="number" inputMode="numeric" min={1} max={480} required defaultValue={pick("kdsLateMinutes")} hasHint error={fe.kdsLateMinutes} />
          </Field>
        </div>
      </Card>

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : "Guardar ajustes"}
        </Button>
      </div>
    </form>
  );
}
