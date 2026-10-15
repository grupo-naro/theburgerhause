import { afterEach, describe, expect, it, vi } from "vitest";
import { ORDERS_CHANNEL, PRINT_CHANNEL } from "./channels";
import { listenerCount, publish, resetBus, subscribe } from "./bus";

afterEach(() => {
  resetBus();
  vi.restoreAllMocks();
});

const ev = { orderId: 1, status: "entregado", event: "status" } as const;

describe("event bus", () => {
  it("delivers to subscribers of that channel only", () => {
    const orders = vi.fn();
    const print = vi.fn();
    subscribe(ORDERS_CHANNEL, orders);
    subscribe(PRINT_CHANNEL, print);
    publish(ORDERS_CHANNEL, ev);
    expect(orders).toHaveBeenCalledWith(ev);
    expect(print).not.toHaveBeenCalled();
  });

  it("delivers resync to resync subscribers", () => {
    const h = vi.fn();
    subscribe("resync", h);
    publish("resync");
    expect(h).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe stops delivery and is idempotent; count tracks it", () => {
    const h = vi.fn();
    expect(listenerCount()).toBe(0);
    const off = subscribe(ORDERS_CHANNEL, h);
    expect(listenerCount()).toBe(1);
    off();
    off();
    expect(listenerCount()).toBe(0);
    publish(ORDERS_CHANNEL, ev);
    expect(h).not.toHaveBeenCalled();
  });

  it("the same function subscribed twice is two subscriptions", () => {
    const h = vi.fn();
    const a = subscribe(ORDERS_CHANNEL, h);
    subscribe(ORDERS_CHANNEL, h);
    a();
    publish(ORDERS_CHANNEL, ev);
    expect(h).toHaveBeenCalledTimes(1);
  });

  it("a throwing handler does not stop the others and logs a fixed string", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const good = vi.fn();
    subscribe(ORDERS_CHANNEL, () => {
      throw new Error("secret payload detail");
    });
    subscribe(ORDERS_CHANNEL, good);
    publish(ORDERS_CHANNEL, ev);
    expect(good).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("[events] bus handler failed");
  });

  it("a handler unsubscribing during publish does not skip others", () => {
    const second = vi.fn();
    const off = subscribe(ORDERS_CHANNEL, () => off());
    subscribe(ORDERS_CHANNEL, second);
    publish(ORDERS_CHANNEL, ev);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("is shared across module instances via globalThis", async () => {
    const h = vi.fn();
    subscribe(ORDERS_CHANNEL, h);
    vi.resetModules();
    const again = await import("./bus");
    again.publish(ORDERS_CHANNEL, ev);
    expect(h).toHaveBeenCalledTimes(1);
  });
});
