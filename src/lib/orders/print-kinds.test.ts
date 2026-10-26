import { describe, expect, it } from "vitest";
import { defaultPrintKinds, hasDeliveryTicket, resolvePrintKinds } from "./print-kinds";

const web = (fulfillment: "delivery" | "takeaway") => ({ channel: "web" as const, fulfillment });
const counter = { channel: "counter" as const, fulfillment: "takeaway" as const };

describe("defaultPrintKinds (what an approval/sale prints)", () => {
  it("Delivery station + web delivery order: kitchen first, then the customer ticket, then the delivery ticket", () => {
    expect(defaultPrintKinds("delivery", web("delivery"))).toEqual(["kitchen", "customer", "delivery"]);
  });
  it("Mostrador station: kitchen + customer, whatever the order", () => {
    expect(defaultPrintKinds("mostrador", web("takeaway"))).toEqual(["kitchen", "customer"]);
    expect(defaultPrintKinds("mostrador", web("delivery"))).toEqual(["kitchen", "customer"]);
    expect(defaultPrintKinds("mostrador", counter)).toEqual(["kitchen", "customer"]);
  });
  it("a delivery station never prints a delivery ticket for an order that is not a delivery", () => {
    expect(defaultPrintKinds("delivery", web("takeaway"))).toEqual(["kitchen", "customer"]);
    expect(defaultPrintKinds("delivery", counter)).toEqual(["kitchen", "customer"]);
  });
});

describe("hasDeliveryTicket", () => {
  it("only web delivery orders", () => {
    expect(hasDeliveryTicket(web("delivery"))).toBe(true);
    expect(hasDeliveryTicket(web("takeaway"))).toBe(false);
    expect(hasDeliveryTicket(counter)).toBe(false);
  });
});

describe("resolvePrintKinds (reprint)", () => {
  it("customer is always available; delivery only for delivery orders", () => {
    expect(resolvePrintKinds("customer", "mostrador", web("takeaway"))).toEqual(["customer"]);
    expect(resolvePrintKinds("delivery", "delivery", web("delivery"))).toEqual(["delivery"]);
    expect(resolvePrintKinds("delivery", "mostrador", web("delivery"))).toEqual(["delivery"]);
    expect(resolvePrintKinds("delivery", "delivery", web("takeaway"))).toBeNull();
  });
  it("both = customer + delivery as before: the default WITHOUT the kitchen ticket", () => {
    expect(resolvePrintKinds("both", "delivery", web("delivery"))).toEqual(["customer", "delivery"]);
    expect(resolvePrintKinds("both", "mostrador", web("takeaway"))).toEqual(["customer"]);
    expect(resolvePrintKinds("both", "mostrador", counter)).toEqual(["customer"]);
  });
  it("kitchen is its own explicit option, for any order and any station", () => {
    for (const station of ["mostrador", "delivery"] as const) {
      for (const order of [web("delivery"), web("takeaway"), counter]) {
        expect(resolvePrintKinds("kitchen", station, order)).toEqual(["kitchen"]);
      }
    }
  });
});
