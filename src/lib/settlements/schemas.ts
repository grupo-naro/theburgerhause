import { z } from "@/lib/zod";
import { cleanText } from "@/lib/orders/schemas";

/**
 * Cadet settlement (rendicion) input contract, core level. Unknown keys are stripped; `userId`
 * is a trusted field filled by the Server Action from the verified session. Money is integer
 * centavos: `expectedAmount` is the debt figure the manager SAW and confirmed, `receivedAmount`
 * the cash the cadet actually handed over (default: all of it). A shortage must be explained.
 */

const INT4_MAX = 2_147_483_647;
export const MAX_SETTLEMENT_NOTE = 200;
export const MIN_SHORTAGE_NOTE = 3;

const id = (msg: string) => z.number({ error: msg }).int(msg).positive(msg).max(INT4_MAX, msg);

export const settlementNoteSchema = z
  .string({ error: "La nota es inválida" })
  .transform(cleanText)
  .pipe(z.string().max(MAX_SETTLEMENT_NOTE, `La nota admite hasta ${MAX_SETTLEMENT_NOTE} caracteres`))
  .transform((n) => (n === "" ? undefined : n));

const receivedAmountSchema = z
  .number({ error: "El efectivo recibido es inválido" })
  .int("El efectivo recibido es inválido")
  .min(0, "El efectivo recibido es inválido")
  .max(INT4_MAX, "El efectivo recibido es inválido");

const settleCadetBase = z.object({
  cadetId: id("Cadete inválido"),
  expectedAmount: id("El monto a rendir es inválido"),
  userId: id("Solicitud inválida"),
  receivedAmount: receivedAmountSchema.optional(),
  note: settlementNoteSchema.optional(),
});

type Shortage = { expectedAmount: number; receivedAmount?: number; note?: string };

/** received > expected is refused; received < expected needs a note explaining the shortage. */
function shortageRules(v: Shortage, ctx: z.RefinementCtx): void {
  if (v.receivedAmount === undefined) return;
  if (v.receivedAmount > v.expectedAmount) {
    ctx.addIssue({ code: "custom", path: ["receivedAmount"], message: "El efectivo recibido no puede superar lo que debía rendir" });
  } else if (v.receivedAmount < v.expectedAmount && (v.note ?? "").length < MIN_SHORTAGE_NOTE) {
    ctx.addIssue({ code: "custom", path: ["note"], message: "Explicá el faltante en la nota" });
  }
}
const withDefault = <T extends Shortage>(v: T) => ({ ...v, receivedAmount: v.receivedAmount ?? v.expectedAmount });

export const settleCadetInputSchema = settleCadetBase.superRefine(shortageRules).transform(withDefault);

/** The client payload of the Server Action: everything but the trusted `userId`. */
export const settleCadetPayloadSchema = settleCadetBase.omit({ userId: true }).superRefine(shortageRules).transform(withDefault);

export type SettleCadetInput = z.infer<typeof settleCadetInputSchema>;
