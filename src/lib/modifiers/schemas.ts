import { z } from "@/lib/zod";
import { normalizeKitchenLabel } from "./kitchen-label";

const id = z.number().int().positive();

export const groupInputSchema = z.object({
  id: id.optional(),
  name: z.string().trim().min(1, "Ingresá un nombre").max(80, "Máximo 80 caracteres"),
});

export const modifierInputSchema = z
  .object({
    id: id.optional(),
    groupId: z.number("Elegí un grupo").int().positive("Elegí un grupo"),
    name: z.string().trim().min(1, "Ingresá un nombre").max(80, "Máximo 80 caracteres"),
    kind: z.enum(["remove", "add", "swap"], "Elegí un tipo"),
    priceArs: z
      .number("Ingresá un precio")
      .int("El precio debe ser en pesos enteros")
      .min(0, "El precio no puede ser negativo")
      .max(100_000_000, "Precio demasiado alto"),
    kitchenLabel: z.string().max(60, "Máximo 60 caracteres").default(""),
    active: z.boolean(),
  })
  .transform((v, ctx) => {
    if (v.kind === "remove" && v.priceArs !== 0) {
      ctx.addIssue({ code: "custom", path: ["priceArs"], message: "Un quite no puede tener precio" });
    }
    const kitchenLabel = normalizeKitchenLabel(v.name, v.kind, v.kitchenLabel);
    if (kitchenLabel.length > 60) {
      ctx.addIssue({ code: "custom", path: ["kitchenLabel"], message: "Máximo 60 caracteres" });
    }
    if (kitchenLabel === "") {
      ctx.addIssue({ code: "custom", path: ["kitchenLabel"], message: "Ingresá un texto para la cocina" });
    }
    return { ...v, kitchenLabel };
  });

export type GroupInput = z.input<typeof groupInputSchema>;
export type ModifierInput = z.input<typeof modifierInputSchema>;
