"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import type { ActionState } from "@/lib/menu/action-state";
import { ImageUploadField } from "../../menu/_components/image-upload-field";
import { savePromoAction } from "../actions";

export type PromoFormValues = {
  imagePath: string | null;
  title: string;
  active: boolean;
  /** datetime-local text, Buenos Aires wall clock; "" = no bound. */
  startsAt: string;
  endsAt: string;
};

export function PromoForm({ initial, previewUrl }: { initial: PromoFormValues; previewUrl: string | null }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(savePromoAction, {});
  const fe = state.fieldErrors ?? {};
  const v = state.values;
  const text = (key: "title" | "startsAt" | "endsAt") => v?.[key] ?? initial[key];
  // An unchecked box is absent from the echoed values: when the form came back with errors, honour that.
  const active = v ? "active" in v : initial.active;

  return (
    <form action={action} className="flex flex-col gap-5">
      <FormMessage>{state.error}</FormMessage>
      <FormMessage tone="success">{state.message}</FormMessage>

      <Card className="flex flex-col gap-4">
        <ImageUploadField
          label="Imagen de la promoción"
          initialPath={initial.imagePath}
          initialPreviewUrl={previewUrl}
          error={fe.imagePath}
        />
        <p className="-mt-2 text-xs text-ink-muted">JPG, PNG o WebP, hasta 5 MB. Se muestra entera, sin recortar.</p>
        <Field label="Título (opcional)" htmlFor="title" hint="Aparece arriba de la imagen. Máximo 120 caracteres." error={fe.title}>
          <Input id="title" name="title" maxLength={120} defaultValue={text("title")} hasHint error={fe.title} />
        </Field>
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="font-display text-xl font-extrabold">Cuándo se muestra</h2>
        <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
          <input type="checkbox" name="active" defaultChecked={active} className="size-5 accent-brand-600" />
          Activa
        </label>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Desde (opcional)" htmlFor="startsAt" hint="Vacío = desde ya." error={fe.startsAt}>
            <Input id="startsAt" name="startsAt" type="datetime-local" defaultValue={text("startsAt")} hasHint error={fe.startsAt} />
          </Field>
          <Field label="Hasta (opcional)" htmlFor="endsAt" hint="Vacío = sin fecha de fin." error={fe.endsAt}>
            <Input id="endsAt" name="endsAt" type="datetime-local" defaultValue={text("endsAt")} hasHint error={fe.endsAt} />
          </Field>
        </div>
      </Card>

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : "Guardar promoción"}
        </Button>
      </div>
    </form>
  );
}
