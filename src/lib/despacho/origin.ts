/**
 * Where a counter-sector order came from, as shown on its card in the unified Mostrador screen:
 * a counter sale or an app (web) order the customer picks up. Delivery orders get no label (they live
 * in their own workspace). Pure.
 */
export function originLabel(o: { channel: "web" | "counter"; fulfillment: "delivery" | "takeaway" }): string | null {
  if (o.fulfillment === "delivery") return null;
  return o.channel === "counter" ? "MOSTRADOR" : "APP · RETIRA EN LOCAL";
}
