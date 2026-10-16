import { z } from "zod";
import { cleanText } from "@/lib/orders/schemas";

/**
 * Cadet settlement (rendicion) input contract, core level. Unknown keys are stripped; `userId`
 * is a trusted field filled by the Server Action from the verified session. Money is integer
 * centavos: `expectedAmount` is the figure the manager SAW and confirmed.
 */

const INT4_MAX = 2_147_483_647;
export const MAX_SETTLEMENT_NOTE = 200;

const id = (msg: string) => z.number({ error: msg }).int(msg).positive(msg).max(INT4_MAX, msg);

export const settlementNoteSchema = z
  .string({ error: "La nota es inválida" })
  .transform(cleanText)
  .pipe(z.string().max(MAX_SETTLEMENT_NOTE, `La nota admite hasta ${MAX_SETTLEMENT_NOTE} caracteres`))
  .transform((n) => (n === "" ? undefined : n));

export const settleCadetInputSchema = z.object({
  cadetId: id("Cadete inválido"),
  expectedAmount: id("El monto a rendir es inválido"),
  userId: id("Solicitud inválida"),
  note: settlementNoteSchema.optional(),
});

export type SettleCadetInput = z.infer<typeof settleCadetInputSchema>;
