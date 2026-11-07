import { z } from "@/lib/zod";

export const PIN_FORMAT_MESSAGE = "El PIN tiene que tener de 4 a 6 números";

/** Setting the analytics PIN: new PIN twice + the logged-in admin's password. */
export const pinInputSchema = z
  .object({
    pin: z.string().regex(/^\d{4,6}$/, PIN_FORMAT_MESSAGE),
    pinConfirm: z.string(),
    password: z.string().min(1, "Ingresá tu contraseña"),
  })
  .refine((v) => v.pin === v.pinConfirm, { path: ["pinConfirm"], message: "Los PIN no coinciden" });
