import { z } from "@/lib/zod";
import { costArsSchema } from "./cost-schema";
import { isValidImagePath } from "@/lib/uploads/storage";
import { slugify } from "./slug";

const imagePath = z
  .string()
  .refine(isValidImagePath, "Imagen inválida")
  .nullish()
  .transform((v) => v ?? null);

const id = z.number().int().positive();

export const categoryInputSchema = z
  .object({
    id: id.optional(),
    name: z.string().trim().min(1, "Ingresá un nombre").max(80, "Máximo 80 caracteres"),
    slug: z.string().optional(),
    imagePath,
    active: z.boolean(),
  })
  .transform((v, ctx) => {
    const slug = slugify(v.slug?.trim() ? v.slug : v.name);
    if (!slug) {
      ctx.addIssue({ code: "custom", path: ["name"], message: "El nombre necesita letras o números" });
      return z.NEVER;
    }
    return { ...v, slug };
  });

export const productInputSchema = z.object({
  id: id.optional(),
  categoryId: z.number().int().positive("Elegí una categoría"),
  name: z.string().trim().min(1, "Ingresá un nombre").max(120, "Máximo 120 caracteres"),
  description: z.string().trim().max(500, "Máximo 500 caracteres").default(""),
  priceArs: z
    .number("Ingresá un precio")
    .int("El precio debe ser en pesos enteros")
    .min(0, "El precio no puede ser negativo")
    .max(100_000_000, "Precio demasiado alto"),
  imagePath,
  active: z.boolean(),
  featured: z.boolean(),
  /** undefined = leave as is (callers that do not manage suggestions). */
  suggest: z.boolean().optional(),
  /** Optional link to a `bebida` stock item. undefined = leave as is, null = unlink. */
  stockItemId: id.nullish(),
  /** Admin-only cost (see cost-schema.ts): undefined = keep, null = clear. */
  costArs: costArsSchema,
  /** Beef patties per unit (0-3). undefined = leave as is (0 on create). */
  patties: z
    .number("Elegí la cantidad de medallones")
    .int("Los medallones son un número entero")
    .min(0, "Entre 0 y 3 medallones")
    .max(3, "Entre 0 y 3 medallones")
    .optional(),
});

export type CategoryInput = z.input<typeof categoryInputSchema>;
export type ProductInput = z.input<typeof productInputSchema>;
export type CategoryData = z.output<typeof categoryInputSchema>;
export type ProductData = z.output<typeof productInputSchema>;
