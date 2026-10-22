import { describe, expect, it } from "vitest";
import { ORDER_STATUSES, type Fulfillment, type OrderStatus } from "@/domain/order-status";
import { trackingSteps } from "./tracking-steps";

type S = "done" | "current" | "upcoming";

const LABELS: Record<Fulfillment, string[]> = {
  delivery: ["Recibido", "Listo", "En camino", "Entregado"],
  takeaway: ["Recibido", "Listo", "Para retirar", "Entregado"],
};

// Literal expectations: the state of the four steps for every (status, fulfillment). Statuses of the other fulfillment map to the same step.
const STATES: Record<Fulfillment, Record<Exclude<OrderStatus, "cancelado">, S[]>> = {
  delivery: {
    pendiente_aprobacion: ["current", "upcoming", "upcoming", "upcoming"],
    en_preparacion: ["done", "current", "upcoming", "upcoming"],
    listo_despacho: ["done", "current", "upcoming", "upcoming"],
    en_camino: ["done", "done", "current", "upcoming"],
    para_retirar: ["done", "done", "current", "upcoming"],
    entregado: ["done", "done", "done", "done"],
  },
  takeaway: {
    pendiente_aprobacion: ["current", "upcoming", "upcoming", "upcoming"],
    en_preparacion: ["done", "current", "upcoming", "upcoming"],
    listo_despacho: ["done", "current", "upcoming", "upcoming"],
    en_camino: ["done", "done", "current", "upcoming"],
    para_retirar: ["done", "done", "current", "upcoming"],
    entregado: ["done", "done", "done", "done"],
  },
};

const KEYS = ["recibido", "listo", "entrega", "entregado"];

describe("trackingSteps", () => {
  it("covers all 7 statuses", () => {
    expect(ORDER_STATUSES).toHaveLength(7);
  });

  for (const fulfillment of ["delivery", "takeaway"] as const) {
    for (const status of Object.keys(STATES[fulfillment]) as (keyof (typeof STATES)["delivery"])[]) {
      it(`${fulfillment} / ${status}`, () => {
        const r = trackingSteps(status, fulfillment);
        expect(r.cancelled).toBe(false);
        expect(r.steps.map((s) => s.label)).toEqual(LABELS[fulfillment]);
        expect(r.steps.map((s) => s.key)).toEqual(KEYS);
        expect(r.steps.map((s) => s.state)).toEqual(STATES[fulfillment][status]);
        expect(r.headline.length).toBeGreaterThan(0);
        expect(r.hint.length).toBeGreaterThan(0);
      });
    }

    it(`${fulfillment} / cancelado has no timeline`, () => {
      expect(trackingSteps("cancelado", fulfillment)).toEqual({
        steps: [],
        cancelled: true,
        headline: "Tu pedido fue cancelado",
        hint: "Si tenés dudas, escribinos por WhatsApp o llamanos y lo vemos juntos.",
      });
    });
  }

  it("pending approval hint depends on the payment method", () => {
    expect(trackingSteps("pendiente_aprobacion", "delivery", "transfer").hint).toBe("Estamos verificando tu pago");
    expect(trackingSteps("pendiente_aprobacion", "takeaway", "cash").hint).toBe("Un cajero va a confirmar tu pedido");
    expect(trackingSteps("pendiente_aprobacion", "delivery").hint).toBe("Un cajero va a confirmar tu pedido");
  });

  it("headlines per status (literal)", () => {
    const h = (s: OrderStatus, f: Fulfillment = "delivery") => trackingSteps(s, f).headline;
    expect(h("pendiente_aprobacion")).toBe("Recibimos tu pedido");
    expect(h("en_preparacion")).toBe("Estamos preparando tu pedido");
    expect(h("listo_despacho")).toBe("Tu pedido está listo");
    expect(h("en_camino")).toBe("Tu pedido está en camino");
    expect(h("para_retirar", "takeaway")).toBe("Tu pedido te espera");
    expect(h("entregado")).toBe("¡Buen provecho!");
  });
});
