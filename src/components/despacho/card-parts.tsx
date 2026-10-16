import type { ReactNode } from "react";
import { TAG, TONE } from "@/components/caja/elapsed-badge";
import { Chip } from "@/components/caja/chips";
import { formatARS } from "@/domain/money";
import { elapsedMs, formatElapsed } from "@/lib/caja/elapsed";
import { orderUrgency, type UrgencyLane } from "@/lib/despacho/urgency";
import type { DispatchOrder } from "@/lib/orders/dispatch-queries";

/** Order number, the main handle staff use to talk about an order. */
export function OrderNumber({ number, className = "text-4xl" }: { number: number; className?: string }) {
  return (
    <span className={`font-display leading-none font-extrabold text-ink ${className}`}>
      <span className="text-ink-muted">#</span>
      {number}
    </span>
  );
}

/** Waiting time since the order was placed, with the Demora / Urgente word (not color alone). */
export function AgeBadge({ order, lane, now, label }: { order: DispatchOrder; lane: UrgencyLane; now: number; label?: string }) {
  const urgency = orderUrgency(lane, order.createdAt, now);
  const tag = TAG[urgency];
  return (
    <span
      data-testid="elapsed"
      data-urgency={urgency}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-base font-bold whitespace-nowrap tabular-nums ${TONE[urgency]}`}
    >
      {tag && <span className="uppercase tracking-wide">{tag} ·</span>}
      {label ? `${label} ` : ""}
      {formatElapsed(elapsedMs(order.createdAt, new Date(now)))}
    </span>
  );
}

/** Left accent bar color from the urgency (same palette as Caja). */
export function urgencyAccent(order: DispatchOrder, lane: UrgencyLane, now: number): string {
  const u = orderUrgency(lane, order.createdAt, now);
  return u === "urgent" ? "border-l-state-error" : u === "warning" ? "border-l-state-pending" : "border-l-transparent";
}

/** "Efectivo pendiente" (amber: money to collect) / "Transferencia pagada" (green) etc. */
export function PaymentBadge({ order }: { order: Pick<DispatchOrder, "paymentMethod" | "paymentStatus"> }) {
  const cash = order.paymentMethod === "cash";
  const paid = order.paymentStatus === "paid";
  const label = `${cash ? "Efectivo" : "Transferencia"} ${paid ? "pagado" : "pendiente"}`.replace("Transferencia pagado", "Transferencia pagada");
  return (
    <Chip
      data-testid="payment-chip"
      data-paid={paid ? "true" : "false"}
      className={paid ? "bg-green-100 text-green-800" : "bg-cheddar-400/50 text-ink ring-1 ring-cheddar-600/60"}
    >
      {label}
    </Chip>
  );
}

export function Total({ cents, className = "text-2xl" }: { cents: number; className?: string }) {
  return (
    <span data-testid="order-total" className={`font-display font-extrabold text-ink tabular-nums ${className}`}>
      {formatARS(cents)}
    </span>
  );
}

function modTone(label: string): string {
  if (label.startsWith("SIN")) return "bg-red-100 text-red-800";
  if (label.startsWith("+")) return "bg-green-100 text-green-800";
  return "bg-cheddar-400/40 text-ink";
}

/** Compact product list: "2× Ranchita simple" plus the kitchen-label chips of each line. */
export function ItemsSummary({ items }: { items: DispatchOrder["items"] }) {
  return (
    <ul aria-label="Productos" className="space-y-1.5">
      {items.map((g, i) => (
        <li key={i} data-testid="order-line" className="text-base leading-snug">
          <span className="font-bold text-ink">
            <span className="mr-1 inline-block min-w-7 rounded-md bg-ink px-1 text-center font-display text-sm text-white tabular-nums">
              {g.quantity}×
            </span>
            {g.name}
          </span>
          {g.modifiers.map((m, j) => {
            const label = (m.kitchenLabel ?? m.name).toUpperCase();
            return (
              <span
                key={j}
                data-testid="mod-chip"
                className={`ml-1.5 inline-block rounded px-1.5 py-px align-middle text-xs font-extrabold tracking-wide ${modTone(label)}`}
              >
                {label}
              </span>
            );
          })}
          {g.note && <span className="ml-1.5 text-sm font-semibold text-ink-muted">· Nota: {g.note}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Big action button: 56 px tall, full width of its container. */
export function BigButton({
  tone = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "primary" | "green" | "violet" | "ghost" | "danger" }) {
  const tones = {
    primary: "bg-brand-600 text-white hover:bg-brand-700",
    green: "bg-green-700 text-white hover:bg-green-800",
    violet: "bg-state-route text-white hover:bg-violet-800",
    ghost: "border-2 border-line bg-surface text-ink hover:bg-brand-50",
    danger: "border-2 border-state-error bg-surface text-state-error hover:bg-red-50",
  } as const;
  return (
    <button
      type="button"
      {...props}
      className={`min-h-14 rounded-full px-5 font-display text-lg font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${tones[tone]} ${className}`}
    />
  );
}

export function CardError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" data-testid="card-error" className="mb-3 rounded-xl border border-state-error bg-red-50 px-4 py-2 text-base font-medium text-state-error">
      {children}
    </p>
  );
}

