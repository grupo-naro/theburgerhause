import { describe, expect, it } from "vitest";
import { defaultPrintKinds, hasDeliveryTicket, resolvePrintKinds } from "./print-kinds";

const web = (fulfillment: "delivery" | "takeaway") => ({ channel: "web" as const, fulfillment });
const counter = { channel: "counter" as const, fulfillment: "takeaway" as const };

describe("defaultPrintKinds (what an approval/sale prints)", () => {
  it("Delivery station + web delivery order: delivery ticket first, then the customer ticket", () => {
    expect(defaultPrintKinds("delivery", web("delivery"))).toEqual(["delivery", "customer"]);
  });
  it("Mostrador station: only the customer ticket, whatever the order", () => {
    expect(defaultPrintKinds("mostrador", web("takeaway"))).toEqual(["customer"]);
    expect(defaultPrintKinds("mostrador", web("delivery"))).toEqual(["customer"]);
    expect(defaultPrintKinds("mostrador", counter)).toEqual(["customer"]);
  });
  it("a delivery station never prints a delivery ticket for an order that is not a delivery", () => {
    expect(defaultPrintKinds("delivery", web("takeaway"))).toEqual(["customer"]);
    expect(defaultPrintKinds("delivery", counter)).toEqual(["customer"]);
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
  it("both = what an approval at that station prints", () => {
    expect(resolvePrintKinds("both", "delivery", web("delivery"))).toEqual(["delivery", "customer"]);
    expect(resolvePrintKinds("both", "mostrador", web("takeaway"))).toEqual(["customer"]);
  });
});
