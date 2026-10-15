"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import type { ActionState } from "@/lib/menu/action-state";
import { saveCategoryAction } from "../actions";
import { ImageUploadField } from "./image-upload-field";

export type CategoryFormValues = {
  id?: number;
  name: string;
  slug: string;
  active: boolean;
  imagePath: string | null;
};

export function CategoryForm({
  initial,
  previewUrl,
}: {
  initial: CategoryFormValues;
  /** Thumbnail URL for `initial.imagePath`, computed on the server. */
  previewUrl: string | null;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveCategoryAction, {});
  const v = state.values;
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex max-w-xl flex-col gap-4">
      {initial.id !== undefined ? <input type="hidden" name="id" value={initial.id} /> : null}
      <FormMessage>{state.error}</FormMessage>
      <Field label="Nombre" htmlFor="name" error={fe.name}>
        <Input id="name" name="name" required maxLength={80} defaultValue={v?.name ?? initial.name} error={fe.name} />
      </Field>
      <Field
        label="Slug (opcional)"
        htmlFor="slug"
        hint="Si lo dejás vacío se genera a partir del nombre."
        error={fe.slug}
      >
        <Input id="slug" name="slug" maxLength={80} defaultValue={v?.slug ?? initial.slug} hasHint error={fe.slug} />
      </Field>
      <ImageUploadField initialPath={initial.imagePath} initialPreviewUrl={previewUrl} error={fe.imagePath} />
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          name="active"
          defaultChecked={v ? "active" in v : initial.active}
          className="size-4 accent-brand-600"
        />
        Categoría activa (visible en el menú)
      </label>
      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : "Guardar"}
        </Button>
        <Link href="/admin/menu" className={buttonClass("secondary")}>
          Cancelar
        </Link>
      </div>
    </form>
  );
}
