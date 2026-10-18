import { z } from "@/lib/zod";

const id = z.number().int().positive();

/** Blank -> null; inner whitespace collapsed; digits, spaces, + - ( ) only. */
const phone = z
  .string()
  .max(60, "Máximo 30 caracteres")
  .default("")
  .transform((v) => v.trim().replace(/\s+/g, " "))
  .pipe(
    z
      .string()
      .max(30, "Máximo 30 caracteres")
      .regex(/^[0-9 +\-()]*$/, "Solo números, espacios, + - y paréntesis"),
  )
  .transform((v) => (v === "" ? null : v));

export const cadetInputSchema = z.object({
  id: id.optional(),
  name: z.string().trim().min(1, "Ingresá un nombre").max(80, "Máximo 80 caracteres"),
  phone,
  active: z.boolean(),
});

export type CadetInput = z.input<typeof cadetInputSchema>;
