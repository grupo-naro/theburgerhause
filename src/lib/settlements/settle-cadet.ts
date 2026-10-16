import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { formatARS } from "@/domain/money";
import { ORDERS_CHANNEL } from "@/lib/events/channels";
import { notifyInTx } from "@/lib/events/notify";
import { pgErrorCode } from "@/lib/orders/create-order";
import { UNEXPECTED_MESSAGE } from "@/lib/orders/transition";
import { settleCadetInputSchema } from "./schemas";

/**
 * Cadet cash settlement ("rendicion"). No next/*. ONE transaction, money in integer centavos.
 *
 * Lock order (the SAME as `assignCadet`, so the two serialize and cannot deadlock):
 *   1. the cadet row FOR UPDATE;
 *   2. the settleable orders in one `ORDER BY id FOR UPDATE` statement.
 * The predicate is exactly the domain `cadetBalance` one: delivered + cash + payment pending
 * (en_camino orders are NEVER included). The amount the manager confirmed (`expectedAmount`)
 * must equal the sum read under those locks, otherwise NOTHING is written: never settle a
 * figure the manager did not see. There is no partial settlement: a cash shortage is recorded
 * in the free-text `note` and the full amount is settled (the cadet's debt goes to zero).
 * Each order can be settled at most once (unique index on `settlement_orders.order_id`).
 * `userId` is a trusted field filled by the Server Action from the verified session.
 */

export type SettleFailureCode = "VALIDATION" | "CADET_NOT_FOUND" | "NOTHING_TO_SETTLE" | "AMOUNT_MISMATCH" | "UNEXPECTED";
export type SettleFailure = {
  ok: false;
  code: SettleFailureCode;
  message: string;
  details?: { expected: number; actual: number; orderCount: number };
};
export type SettleData = {
  settlementId: number;
  /** Centavos. */
  amount: number;
  orderCount: number;
  orders: { id: number; number: number; total: number }[];
  cadet: { id: number; name: string };
};
export type SettleResult = { ok: true; data: SettleData } | SettleFailure;

const fail = (code: SettleFailureCode, message: string, details?: SettleFailure["details"]): SettleFailure =>
  details ? { ok: false, code, message, details } : { ok: false, code, message };

const nothingToSettle = (name: string) => fail("NOTHING_TO_SETTLE", `${name} no tiene efectivo pendiente de rendir`);

/** True when `err` is the unique violation of the "order settled at most once" index. */
function isOrderAlreadySettled(err: unknown): boolean {
  for (let e: unknown = err; e; e = (e as { cause?: unknown }).cause) {
    const x = e as { code?: unknown; constraint?: unknown };
    if (x.code === "23505" && x.constraint === "settlement_orders_order_uniq") return true;
  }
  return false;
}

export async function settleCadet(
  db: Db,
  raw: { cadetId: number; expectedAmount: number; userId: number; note?: string },
): Promise<SettleResult> {
  const input = settleCadetInputSchema.safeParse(raw);
  if (!input.success) return fail("VALIDATION", input.error.issues[0]?.message ?? "Solicitud inválida");
  const { cadetId, expectedAmount, userId, note } = input.data;

  let cadetName = "El cadete";
  try {
    return await db.transaction(async (tx): Promise<SettleResult> => {
      const [cadet] = await tx
        .select({ id: s.cadets.id, name: s.cadets.name })
        .from(s.cadets)
        .where(eq(s.cadets.id, cadetId))
        .for("update");
      if (!cadet) return fail("CADET_NOT_FOUND", "El cadete no existe");
      cadetName = cadet.name;

      const owing = and(
        eq(s.orders.cadetId, cadetId),
        eq(s.orders.status, "entregado"),
        eq(s.orders.paymentMethod, "cash"),
        eq(s.orders.paymentStatus, "pending"),
      );
      const rows = await tx
        .select({ id: s.orders.id, number: s.orders.number, total: s.orders.total })
        .from(s.orders)
        .where(owing)
        .orderBy(s.orders.id)
        .for("update");
      if (rows.length === 0) return nothingToSettle(cadet.name);

      const actual = rows.reduce((sum, o) => sum + o.total, 0);
      if (!Number.isSafeInteger(actual)) throw new Error("settlement sum is not a safe integer");
      if (actual !== expectedAmount) {
        return fail(
          "AMOUNT_MISMATCH",
          `El efectivo pendiente de ${cadet.name} cambió: ahora son ${formatARS(actual)} (${rows.length} ${rows.length === 1 ? "pedido" : "pedidos"}) y esperabas ${formatARS(expectedAmount)}. Revisá el detalle y volvé a confirmar.`,
          { expected: expectedAmount, actual, orderCount: rows.length },
        );
      }

      const [settlement] = await tx
        .insert(s.settlements)
        .values({ cadetId, amount: actual, settledBy: userId, note: note ?? null })
        .returning({ id: s.settlements.id });
      await tx
        .insert(s.settlementOrders)
        .values(rows.map((o) => ({ settlementId: settlement.id, orderId: o.id, amount: o.total })));

      const ids = rows.map((o) => o.id);
      const paid = await tx
        .update(s.orders)
        .set({ paymentStatus: "paid" })
        .where(and(inArray(s.orders.id, ids), owing))
        .returning({ id: s.orders.id });
      // The rows are locked, so this cannot normally differ: defense in depth against a half settlement.
      if (paid.length !== rows.length) throw new Error("settlement updated an unexpected number of orders");

      await tx.insert(s.orderEvents).values(
        rows.map((o) => ({
          orderId: o.id,
          fromStatus: "entregado" as const,
          toStatus: "entregado" as const,
          userId,
          note: `Rendición #${settlement.id}`,
        })),
      );
      // Queued in the transaction: delivered by Postgres only if it commits.
      for (const o of rows) await notifyInTx(tx, ORDERS_CHANNEL, { orderId: o.id, status: "entregado", event: "settled" });

      return {
        ok: true,
        data: {
          settlementId: settlement.id,
          amount: actual,
          orderCount: rows.length,
          orders: rows.map((o) => ({ id: o.id, number: o.number, total: o.total })),
          cadet: { id: cadet.id, name: cadet.name },
        },
      };
    });
  } catch (err) {
    // Defensive: an order already linked to a settlement (inconsistent data) is "already settled".
    if (isOrderAlreadySettled(err)) return nothingToSettle(cadetName);
    console.error("[settlements] settleCadet failed", pgErrorCode(err) ?? "");
    return fail("UNEXPECTED", UNEXPECTED_MESSAGE);
  }
}
