"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import type { ActionState } from "@/lib/menu/action-state";
import { saveProductAction } from "../actions";
import { ImageUploadField } from "./image-upload-field";

export type ProductFormValues = {
  id?: number;
  categoryId: number | null;
  name: string;
  description: string;
  priceArs: number | null;
  active: boolean;
  featured: boolean;
  imagePath: string | null;
};

export function ProductForm({
  initial,
  categories,
  previewUrl,
}: {
  initial: ProductFormValues;
  categories: { id: number; name: string }[];
  previewUrl: string | null;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveProductAction, {});
  const v = state.values;
  const fe = state.fieldErrors ?? {};
  const checked = (key: "active" | "featured") => (v ? key in v : initial[key]);
  return (
    <form action={action} className="flex max-w-xl flex-col gap-4">
      {initial.id !== undefined ? <input type="hidden" name="id" value={initial.id} /> : null}
      <FormMessage>{state.error}</FormMessage>
      <Field label="Categoría" htmlFor="categoryId" error={fe.categoryId}>
        <Select
          id="categoryId"
          name="categoryId"
          required
          defaultValue={v?.categoryId ?? (initial.categoryId === null ? "" : String(initial.categoryId))}
          error={fe.categoryId}
        >
          <option value="" disabled>
            Elegí una categoría
          </option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Nombre" htmlFor="name" error={fe.name}>
        <Input id="name" name="name" required maxLength={120} defaultValue={v?.name ?? initial.name} error={fe.name} />
      </Field>
      <Field label="Descripción" htmlFor="description" hint="Hasta 500 caracteres." error={fe.description}>
        <Textarea
          id="description"
          name="description"
          rows={3}
          maxLength={500}
          defaultValue={v?.description ?? initial.description}
          hasHint
          error={fe.description}
        />
      </Field>
      <Field label="Precio (pesos)" htmlFor="priceArs" hint="Pesos enteros, sin puntos ni comas. Ej: 14400" error={fe.priceArs}>
        <Input
          id="priceArs"
          name="priceArs"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          required
          defaultValue={v?.priceArs ?? (initial.priceArs === null ? "" : String(initial.priceArs))}
          hasHint
          error={fe.priceArs}
        />
      </Field>
      <ImageUploadField initialPath={initial.imagePath} initialPreviewUrl={previewUrl} error={fe.imagePath} />
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" name="active" defaultChecked={checked("active")} className="size-4 accent-brand-600" />
        Producto activo (visible en el menú)
      </label>
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" name="featured" defaultChecked={checked("featured")} className="size-4 accent-brand-600" />
        Destacado en la portada
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
