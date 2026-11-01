import { z } from "@/lib/zod";
import { isValidImagePath } from "@/lib/uploads/storage";
import { parseBaInput } from "./window";

/** An empty or missing `datetime-local` is "no bound"; a malformed one is a field error. */
const dateTime = z
  .string()
  .nullish()
  .transform((v, ctx) => {
    const raw = (v ?? "").trim();
    if (raw === "") return null;
    const d = parseBaInput(raw);
    if (!d) {
      ctx.addIssue({ code: "custom", message: "Fecha y hora inválidas" });
      return z.NEVER;
    }
    return d;
  });

export const promoInputSchema = z
  .object({
    imagePath: z
      .string()
      .refine(isValidImagePath, "Imagen inválida")
      .nullish()
      .transform((v) => v ?? null),
    title: z
      .string()
      .trim()
      .max(120, "Máximo 120 caracteres")
      .nullish()
      .transform((v) => (v ? v : null)),
    active: z.boolean(),
    startsAt: dateTime,
    endsAt: dateTime,
  })
  .superRefine((v, ctx) => {
    if (v.startsAt && v.endsAt && v.endsAt.getTime() <= v.startsAt.getTime()) {
      ctx.addIssue({ code: "custom", path: ["endsAt"], message: "El fin tiene que ser posterior al inicio" });
    }
  });

export type PromoInput = z.input<typeof promoInputSchema>;
