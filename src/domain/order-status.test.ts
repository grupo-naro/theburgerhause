import { describe, expect, it } from "vitest";
import {
  ORDER_STATUSES,
  canTransition,
  nextStatuses,
  type Fulfillment,
  type OrderStatus,
} from "@/domain/order-status";

describe("canTransition", () => {
  it("aprueba un pedido pendiente (ambos tipos de entrega)", () => {
    expect(canTransition("pendiente_aprobacion", "en_preparacion", "delivery")).toBe(true);
    expect(canTransition("pendiente_aprobacion", "en_preparacion", "takeaway")).toBe(true);
  });
  it("permite rechazar solo desde pendiente", () => {
    expect(canTransition("pendiente_aprobacion", "cancelado", "delivery")).toBe(true);
    expect(canTransition("en_preparacion", "cancelado", "delivery")).toBe(false);
  });
  it("delivery va a en_camino, takeaway a para_retirar", () => {
    expect(canTransition("listo_despacho", "en_camino", "delivery")).toBe(true);
    expect(canTransition("listo_despacho", "para_retirar", "delivery")).toBe(false);
    expect(canTransition("listo_despacho", "para_retirar", "takeaway")).toBe(true);
    expect(canTransition("listo_despacho", "en_camino", "takeaway")).toBe(false);
  });
  it("una entrega fallida vuelve a despacho", () => {
    expect(canTransition("en_camino", "listo_despacho", "delivery")).toBe(true);
  });
  it("no se puede saltar etapas", () => {
    expect(canTransition("pendiente_aprobacion", "entregado", "delivery")).toBe(false);
    expect(canTransition("en_preparacion", "en_camino", "delivery")).toBe(false);
  });
  it("estados finales no tienen salida", () => {
    expect(nextStatuses("entregado", "delivery")).toEqual([]);
    expect(nextStatuses("cancelado", "takeaway")).toEqual([]);
  });
});

describe("transition table (spec §4)", () => {
  const EXPECTED: Record<OrderStatus, Record<Fulfillment, OrderStatus[]>> = {
    pendiente_aprobacion: { delivery: ["en_preparacion", "cancelado"], takeaway: ["en_preparacion", "cancelado"] },
    en_preparacion: { delivery: ["listo_despacho"], takeaway: ["listo_despacho"] },
    listo_despacho: { delivery: ["en_camino"], takeaway: ["para_retirar"] },
    en_camino: { delivery: ["entregado", "listo_despacho"], takeaway: [] },
    para_retirar: { delivery: ["entregado"], takeaway: ["entregado"] },
    entregado: { delivery: [], takeaway: [] },
    cancelado: { delivery: [], takeaway: [] },
  };
  const FULFILLMENTS: Fulfillment[] = ["delivery", "takeaway"];

  for (const from of ORDER_STATUSES) {
    for (const f of FULFILLMENTS) {
      it(`nextStatuses(${from}, ${f}) coincide con la tabla`, () => {
        expect([...nextStatuses(from, f)].sort()).toEqual([...EXPECTED[from][f]].sort());
      });
    }
  }

  it("canTransition es verdadero exactamente para las transiciones de la tabla", () => {
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) {
        for (const f of FULFILLMENTS) {
          expect(canTransition(from, to, f), `${from} -> ${to} (${f})`).toBe(
            EXPECTED[from][f].includes(to),
          );
        }
      }
    }
  });
});
