import { z } from "zod";
import { idempotencyKeySchema, text, unitSchema } from "./schemas";

/**
 * Counter-sale input contracts. Objects are NOT strict: unknown keys (a forged `total`,
 * `status`, `price`, `userId`...) are STRIPPED. Two layers:
 *  - `counterClientSchema`: what the browser may send. The Server Action parses with THIS, so a
 *    client-supplied `userId`/`stationId` can never survive.
 *  - `counterOrderSchema`: the core's input, adding the trusted `userId`/`stationId` that the
 *    Action fills from the verified session.
 */

const INT4_MAX = 2_147_483_647;

export const PAGER_MIN = 1;
export const PAGER_MAX = 999;

export const counterClientSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  units: z.array(unitSchema, { error: "El pedido está vacío" }).min(1, "El pedido está vacío").max(100, "El pedido es demasiado grande"),
  paymentMethod: z.enum(["cash", "transfer"], { error: "Elegí un medio de pago" }),
  pagerNumber: z
    .number({ error: "Ingresá el número de llamador" })
    .int("Ingresá el número de llamador")
    .min(PAGER_MIN, "El llamador va de 1 a 999")
    .max(PAGER_MAX, "El llamador va de 1 a 999"),
  /** Optional; blank means "no name". */
  customerName: text(0, 80)
    .optional()
    .transform((n) => (n === undefined || n === "" ? undefined : n)),
});

const trustedId = z.number().int().positive().max(INT4_MAX);

export const counterOrderSchema = counterClientSchema.extend({
  userId: trustedId,
  stationId: trustedId.nullable(),
});

export type CounterClientInput = z.input<typeof counterClientSchema>;
export type CounterOrderInput = z.output<typeof counterOrderSchema>;
