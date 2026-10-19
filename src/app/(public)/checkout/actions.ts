"use server";

import { headers } from "next/headers";
import { getDb } from "@/db/client";
import { clientIp } from "@/lib/client-ip";
import { invalidateMenu } from "@/lib/menu/cache";
import {
  createOrder,
  orderKeyExists,
  pgErrorCode,
  type CreateOrderData,
  type CreateOrderFailure,
} from "@/lib/orders/create-order";
import { canCreate, checkAttempt, recordCreation } from "@/lib/orders/order-rate-limit";
import { createOrderSchema } from "@/lib/orders/schemas";

/**
 * Thin, public (no auth) wrapper around `createOrder`: client IP -> rate limits (BEFORE
 * any creation) -> core -> serializable result. Expected failures are returned, never thrown.
 * Orders are not cached anywhere; the public menu is refreshed only when the sale left a linked
 * drink at zero (its stock pause flipped, `menuChanged`).
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

    // Loose per-IP cap on ANY request (bounds DB cost), evaluated before any DB access.
    if (!checkAttempt(ip).ok) return RATE_LIMITED;

    // Strict creation quota: only well-formed submissions for a NEW order are checked (peek,
    // nothing consumed). A replay of an existing order (same idempotency key) is never blocked.
    const parsed = createOrderSchema.safeParse(input);
    const quota =
      parsed.success && parsed.data.bh_ref.trim() === "" ? parsed.data : null;
    if (quota && !(await orderKeyExists(db, quota.idempotencyKey)) && !canCreate(ip, quota.customer.whatsapp).ok) {
      return RATE_LIMITED;
    }

    const result = await createOrder(db, input, {});
    if (!result.ok) return result;
    // Only a successful NEW creation consumes quota (parallel double submits create one order).
    if (quota && !result.data.duplicate) recordCreation(ip, quota.customer.whatsapp);
    const { menuChanged, ...data } = result.data;
    if (menuChanged) invalidateMenu();
    return { ok: true, ...data };
  } catch (err) {
    // Fixed string + SQLSTATE only: never the message, SQL text, params or stack.
    console.error("[createOrderAction] unexpected error", pgErrorCode(err) ?? "unknown");
    return INTERNAL;
  }
}
