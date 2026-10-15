import type { Fulfillment, OrderStatus } from "@/domain/order-status";

/** Pure view model of the customer timeline. No next/*, no DB. */

export type StepState = "done" | "current" | "upcoming";
export type TrackingStep = { key: string; label: string; state: StepState };
export type TrackingSteps = { steps: TrackingStep[]; cancelled: boolean; headline: string; hint: string };
export type TrackedPaymentMethod = "cash" | "transfer";

const STEP_KEYS = ["recibido", "en_preparacion", "listo", "entrega", "entregado"] as const;

function labels(fulfillment: Fulfillment): string[] {
  return ["Recibido", "En preparación", "Listo", fulfillment === "delivery" ? "En camino" : "Para retirar", "Entregado"];
}

/** Index of the current step per status; 5 = everything done. */
const POSITION: Record<Exclude<OrderStatus, "cancelado">, number> = {
  pendiente_aprobacion: 0,
  en_preparacion: 1,
  listo_despacho: 2,
  en_camino: 3,
  para_retirar: 3,
  entregado: 5,
};

const COPY: Record<Exclude<OrderStatus, "cancelado" | "pendiente_aprobacion">, { headline: string; hint: string }> = {
  en_preparacion: { headline: "Estamos preparando tu pedido", hint: "Ya está en la cocina." },
  listo_despacho: { headline: "Tu pedido está listo", hint: "En un momento sale o te avisamos para retirarlo." },
  en_camino: { headline: "Tu pedido está en camino", hint: "El cadete va hacia tu domicilio." },
  para_retirar: { headline: "Tu pedido te espera", hint: "Pasá a retirarlo por el local." },
  entregado: { headline: "¡Buen provecho!", hint: "Tu pedido fue entregado. ¡Gracias por elegirnos!" },
};

export function trackingSteps(
  status: OrderStatus,
  fulfillment: Fulfillment,
  paymentMethod?: TrackedPaymentMethod,
): TrackingSteps {
  if (status === "cancelado") {
    return {
      steps: [],
      cancelled: true,
      headline: "Tu pedido fue cancelado",
      hint: "Si tenés dudas, escribinos por WhatsApp o llamanos y lo vemos juntos.",
    };
  }
  const at = POSITION[status];
  const names = labels(fulfillment);
  const steps = STEP_KEYS.map((key, i): TrackingStep => ({
    key,
    label: names[i],
    state: i < at ? "done" : i === at ? "current" : "upcoming",
  }));
  if (status === "pendiente_aprobacion") {
    return {
      steps,
      cancelled: false,
      headline: "Recibimos tu pedido",
      hint: paymentMethod === "transfer" ? "Estamos verificando tu pago" : "Un cajero va a confirmar tu pedido",
    };
  }
  return { steps, cancelled: false, ...COPY[status] };
}
