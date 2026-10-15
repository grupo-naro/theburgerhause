"use server";

import { headers } from "next/headers";
import { getDb } from "@/db/client";
import { clientIp } from "@/lib/client-ip";
import {
  createOrder,
  orderKeyExists,
  pgErrorCode,
  type CreateOrderData,
  type CreateOrderFailure,
} from "@/lib/orders/create-order";
import { checkOrderRate, checkReplayRate } from "@/lib/orders/order-rate-limit";
import { createOrderSchema } from "@/lib/orders/schemas";

/**
 * Thin, public (no auth) wrapper around `createOrder`: client IP -> rate limits (BEFORE
 * any creation) -> core -> serializable result. Expected failures are returned, never thrown.
 * Orders are not cached anywhere, so nothing needs revalidating.
 */

export type ActionResult =
  | ({ ok: true } & CreateOrderData)
  | (Omit<CreateOrderFailure, "code"> & { code: CreateOrderFailure["code"] | "RATE_LIMITED" | "INTERNAL" });

const RATE_LIMITED: ActionResult = {
  ok: false,
  code: "RATE_LIMITED",
  message: "Demasiados pedidos seguidos. Esperá unos minutos o llamanos.",
};
const INTERNAL: ActionResult = {
  ok: false,
  code: "INTERNAL",
  message: "No pudimos crear tu pedido. Probá de nuevo en unos minutos.",
};

export async function createOrderAction(input: unknown): Promise<ActionResult> {
  try {
    const db = getDb();
    const ip = clientIp(await headers());

    // Only well-formed submissions cost DB work, so only those are limited. A replay of an
    // order that already exists (same idempotency key) does not consume the order quotas.
    const parsed = createOrderSchema.safeParse(input);
    if (parsed.success && parsed.data.website.trim() === "") {
      const replay = await orderKeyExists(db, parsed.data.idempotencyKey);
      const allowed = replay ? checkReplayRate(ip).ok : checkOrderRate(ip, parsed.data.customer.whatsapp).ok;
      if (!allowed) return RATE_LIMITED;
    }

    const result = await createOrder(db, input, {});
    return result.ok ? { ok: true, ...result.data } : result;
  } catch (err) {
    // Fixed string + SQLSTATE only: never the message, SQL text, params or stack.
    console.error("[createOrderAction] unexpected error", pgErrorCode(err) ?? "unknown");
    return INTERNAL;
  }
}
