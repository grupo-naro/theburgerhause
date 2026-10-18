import { z } from "@/lib/zod";
import { cleanText } from "./schemas";

/**
 * Dispatch input contracts (core level). Objects are NOT strict: unknown keys are stripped.
 * `userId` is a trusted field filled by the Server Action from the verified session.
 */

const INT4_MAX = 2_147_483_647;
const id = (msg: string) => z.number({ error: msg }).int(msg).positive(msg).max(INT4_MAX, msg);

export const MAX_ASSIGN_ORDERS = 50;

export const orderIdInputSchema = z.object({ orderId: id("Pedido inválido"), userId: id("Solicitud inválida") });

export const markDeliveredInputSchema = orderIdInputSchema.extend({ collected: z.boolean().optional() });

export const returnReasonSchema = z
  .string({ error: "Indicá el motivo de la entrega fallida" })
  .transform(cleanText)
  .pipe(z.string().min(3, "El motivo es demasiado corto").max(200, "El motivo es demasiado largo"));

export const returnToDispatchInputSchema = orderIdInputSchema.extend({ reason: returnReasonSchema });

export const assignCadetInputSchema = z.object({
  orderIds: z
    .array(id("Pedido inválido"), { error: "Elegí al menos un pedido" })
    .min(1, "Elegí al menos un pedido")
    .max(MAX_ASSIGN_ORDERS, `Podés asignar hasta ${MAX_ASSIGN_ORDERS} pedidos a la vez`)
    .transform((ids) => [...new Set(ids)]),
  cadetId: id("Cadete inválido"),
  userId: id("Solicitud inválida"),
});
