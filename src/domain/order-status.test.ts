import { describe, expect, it } from "vitest";
import { canTransition, nextStatuses } from "@/domain/order-status";

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
