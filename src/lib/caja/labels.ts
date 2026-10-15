import type { OrderStatus } from "@/domain/order-status";

export const STATUS_LABEL: Record<OrderStatus, string> = {
  pendiente_aprobacion: "Pendiente",
  en_preparacion: "En preparación",
  listo_despacho: "Listo para despacho",
  en_camino: "En camino",
  para_retirar: "Para retirar",
  entregado: "Entregado",
  cancelado: "Cancelado",
};

export const FULFILLMENT_LABEL = { delivery: "Delivery", takeaway: "Retiro" } as const;
export const PAYMENT_LABEL = { cash: "Efectivo", transfer: "Transferencia" } as const;

/** Statuses for which a (re)print makes sense: approved and not cancelled. */
const REPRINTABLE: readonly OrderStatus[] = ["en_preparacion", "listo_despacho", "en_camino", "para_retirar", "entregado"];
export const canReprint = (status: OrderStatus): boolean => REPRINTABLE.includes(status);

export type PrintChipState = "pending" | "ok" | "failed";

/** One chip per kind of job state present on the order (nothing printed yet shows nothing). */
export function printChips(p: { pending: number; failed: number; done: number }): { state: PrintChipState; label: string }[] {
  const chips: { state: PrintChipState; label: string }[] = [];
  if (p.failed > 0) chips.push({ state: "failed", label: "Impresión: falló" });
  if (p.pending > 0) chips.push({ state: "pending", label: "Impresión: pendiente" });
  if (p.done > 0 && p.failed === 0 && p.pending === 0) chips.push({ state: "ok", label: "Impresión: ok" });
  return chips;
}

/** wa.me link from whatever the customer typed; null when there are not enough digits. */
export function whatsappHref(raw: string | null): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.length >= 8 ? `https://wa.me/${digits}` : null;
}

const timeFmt = new Intl.DateTimeFormat("es-AR", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "America/Argentina/Buenos_Aires",
});
/** Order time as HH:mm in Argentina's time zone (same on server and client). */
export const formatOrderTime = (iso: string): string => timeFmt.format(new Date(iso));
