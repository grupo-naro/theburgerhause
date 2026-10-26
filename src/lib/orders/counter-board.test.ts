import { describe, expect, it } from "vitest";
import { boardZone, onCounterBoard, PREPARING_STATUSES, READY_STATUSES } from "./counter-board";

describe("onCounterBoard", () => {
  it("counter sales and web takeaway orders are on the counter screen", () => {
    expect(onCounterBoard({ channel: "counter", fulfillment: "takeaway" })).toBe(true);
    expect(onCounterBoard({ channel: "web", fulfillment: "takeaway" })).toBe(true);
  });
  it("a delivery order NEVER is, whatever the channel", () => {
    expect(onCounterBoard({ channel: "web", fulfillment: "delivery" })).toBe(false);
    expect(onCounterBoard({ channel: "counter", fulfillment: "delivery" })).toBe(false);
  });
});

describe("boardZone", () => {
  it("en_preparacion is 'preparing'; listo_despacho and para_retirar are 'ready'", () => {
    expect(boardZone("en_preparacion")).toBe("preparing");
    expect(boardZone("listo_despacho")).toBe("ready");
    expect(boardZone("para_retirar")).toBe("ready");
  });
  it.each(["pendiente_aprobacion", "cancelado", "entregado", "en_camino"] as const)("%s is not on the screen", (status) => {
    expect(boardZone(status)).toBeNull();
  });
  it("the status lists match the zones", () => {
    expect([...PREPARING_STATUSES]).toEqual(["en_preparacion"]);
    expect([...READY_STATUSES]).toEqual(["listo_despacho", "para_retirar"]);
  });
});
