import { z } from "@/lib/zod";

const id = z.number().int().positive();

/** Blank = "unchanged" on edit; required on create (enforced in the transform below). Never trimmed. */
const password = z
  .string()
  .max(256, "Máximo 256 caracteres")
  .optional()
  .transform((v) => (v === undefined || v === "" ? undefined : v))
  .pipe(z.string().min(8, "Mínimo 8 caracteres").optional());

export const userInputSchema = z
  .object({
    id: id.optional(),
    name: z.string().trim().min(1, "Ingresá un nombre").max(80, "Máximo 80 caracteres"),
    username: z
      .string()
      .trim()
      .min(3, "Mínimo 3 caracteres")
      .max(40, "Máximo 40 caracteres")
      .regex(/^[a-z0-9._-]+$/i, "Solo letras, números, punto, guion y guion bajo")
      .transform((v) => v.toLowerCase()),
    role: z.enum(["admin", "cajera", "encargada_delivery"], "Elegí un rol"),
    active: z.boolean(),
    password,
  })
  .superRefine((v, ctx) => {
    if (v.id === undefined && v.password === undefined) {
      ctx.addIssue({ code: "custom", path: ["password"], message: "Ingresá una contraseña (mínimo 8 caracteres)" });
    }
  });

export type UserInput = z.input<typeof userInputSchema>;
