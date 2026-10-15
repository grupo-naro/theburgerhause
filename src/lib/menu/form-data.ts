import { z } from "zod";

const text = (fd: FormData, key: string): string => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};
const checkbox = (fd: FormData, key: string) => fd.has(key);
const optionalId = (fd: FormData) => {
  const raw = text(fd, "id").trim();
  return raw === "" ? undefined : Number(raw);
};

/** Raw form values echoed back to the form when validation fails. */
export function rawValues(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string") out[k] = v;
  return out;
}

export function categoryFromForm(fd: FormData) {
  return {
    id: optionalId(fd),
    name: text(fd, "name"),
    slug: text(fd, "slug") || undefined,
    imagePath: text(fd, "imagePath") || null,
    active: checkbox(fd, "active"),
  };
}

export function productFromForm(fd: FormData) {
  const price = text(fd, "priceArs").trim();
  return {
    id: optionalId(fd),
    categoryId: Number(text(fd, "categoryId") || Number.NaN),
    name: text(fd, "name"),
    description: text(fd, "description"),
    priceArs: price === "" ? Number.NaN : Number(price),
    imagePath: text(fd, "imagePath") || null,
    active: checkbox(fd, "active"),
    featured: checkbox(fd, "featured"),
  };
}

const idSchema = z.coerce.number().int().positive();

export function parseId(fd: FormData): number | null {
  const r = idSchema.safeParse(text(fd, "id"));
  return r.success ? r.data : null;
}

export function parseDirection(fd: FormData): "up" | "down" | null {
  const v = text(fd, "dir");
  return v === "up" || v === "down" ? v : null;
}

export function parseBoolValue(fd: FormData): boolean | null {
  const v = text(fd, "value");
  return v === "true" ? true : v === "false" ? false : null;
}
