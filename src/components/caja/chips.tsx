import type { ReactNode } from "react";
import type { Fulfillment, OrderStatus } from "@/domain/order-status";
import { FULFILLMENT_LABEL, PAYMENT_LABEL, STATUS_LABEL, type PrintChipState } from "@/lib/caja/labels";

const base = "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-bold leading-tight whitespace-nowrap";

export function Chip({ className, children, ...rest }: { className: string; children: ReactNode } & { [K in `data-${string}`]?: string }) {
  return (
    <span className={`${base} ${className}`} {...rest}>
      {children}
    </span>
  );
}

export const ServiceChip = ({ fulfillment }: { fulfillment: Fulfillment }) => (
  <Chip
    data-testid="service-chip"
    className={fulfillment === "delivery" ? "bg-violet-100 text-violet-800" : "bg-brand-50 text-brand-700"}
  >
    {FULFILLMENT_LABEL[fulfillment]}
  </Chip>
);

export const PaymentChip = ({ method }: { method: "cash" | "transfer" }) => (
  <Chip
    data-testid="payment-chip"
    className={method === "transfer" ? "bg-cheddar-400/40 text-ink" : "bg-green-100 text-green-800"}
  >
    {PAYMENT_LABEL[method]}
  </Chip>
);

const STATUS_TONE: Record<OrderStatus, string> = {
  pendiente_aprobacion: "bg-amber-100 text-amber-900",
  en_preparacion: "bg-brand-50 text-brand-700",
  listo_despacho: "bg-green-100 text-green-800",
  en_camino: "bg-violet-100 text-violet-800",
  para_retirar: "bg-violet-100 text-violet-800",
  entregado: "bg-slate-100 text-slate-700",
  cancelado: "bg-red-100 text-red-800",
};

export const StatusChip = ({ status }: { status: OrderStatus }) => (
  <Chip data-testid="status-chip" className={STATUS_TONE[status]}>
    {STATUS_LABEL[status]}
  </Chip>
);

const PRINT_TONE: Record<PrintChipState, string> = {
  pending: "bg-amber-100 text-amber-900",
  ok: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
};

export const PrintChip = ({ state, label }: { state: PrintChipState; label: string }) => (
  <Chip data-testid="print-chip" data-state={state} className={`${PRINT_TONE[state]} !py-0.5 !text-xs`}>
    {label}
  </Chip>
);
