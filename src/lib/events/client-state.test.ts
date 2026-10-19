import { describe, expect, it, vi } from "vitest";
import { createFakeClock } from "./fake-clock";
import { createLiveClient, type EventSourceLike } from "./client-state";

class FakeSource implements EventSourceLike {
  static all: FakeSource[] = [];
  readyState = 0; // CONNECTING
  closed = false;
  private handlers = new Map<string, Array<(e: { data?: string }) => void>>();
  constructor(readonly url: string) {
    FakeSource.all.push(this);
  }
  addEventListener(type: string, fn: (e: { data?: string }) => void) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]);
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  emit(type: string, data?: string) {
    for (const fn of this.handlers.get(type) ?? []) fn({ data });
  }
  open() {
    this.readyState = 1;
    this.emit("open");
  }
  fail(permanent = false) {
    this.readyState = permanent ? 2 : 0;
    this.emit("error");
  }
}

function setup() {
  FakeSource.all = [];
  const clock = createFakeClock();
  const onOrders = vi.fn();
  const onResync = vi.fn();
  const onStock = vi.fn();
  const states: string[] = [];
  const client = createLiveClient({
    url: "/api/events",
    createSource: (url) => new FakeSource(url),
    schedule: clock.schedule,
    cancel: clock.cancel,
    onOrders,
    onStock,
    onResync,
    onState: (s) => states.push(s),
  });
  const src = () => FakeSource.all[FakeSource.all.length - 1];
  return { clock, onOrders, onStock, onResync, states, client, src };
}

const ev = { orderId: 5, status: "en_preparacion", event: "status" };

describe("live client state machine", () => {
  it("starts connecting, becomes live on open WITHOUT a resync the first time", () => {
    const t = setup();
    t.client.start();
    expect(t.client.state()).toBe("connecting");
    expect(t.src().url).toBe("/api/events");
    t.src().open();
    expect(t.client.state()).toBe("live");
    expect(t.onResync).not.toHaveBeenCalled();
  });

  it("forwards parsed orders events and ignores malformed ones", () => {
    const t = setup();
    t.client.start();
    t.src().open();
    t.src().emit("orders", JSON.stringify(ev));
    t.src().emit("orders", "not json");
    t.src().emit("orders", JSON.stringify({ nope: 1 }));
    expect(t.onOrders).toHaveBeenCalledTimes(1);
    expect(t.onOrders).toHaveBeenCalledWith(ev);
  });

  it("forwards parsed stock events and ignores malformed ones", () => {
    const t = setup();
    t.client.start();
    t.src().open();
    const stock = { itemId: 3, reason: "ingreso" };
    t.src().emit("stock", JSON.stringify(stock));
    t.src().emit("stock", "not json");
    t.src().emit("stock", JSON.stringify({ itemId: "3" }));
    expect(t.onStock).toHaveBeenCalledTimes(1);
    expect(t.onStock).toHaveBeenCalledWith(stock);
    expect(t.onOrders).not.toHaveBeenCalled();
  });

  it("calls onResync for resync events", () => {
    const t = setup();
    t.client.start();
    t.src().open();
    t.src().emit("resync", "{}");
    expect(t.onResync).toHaveBeenCalledTimes(1);
  });

  it("a drop then re-open resyncs once and returns to live", () => {
    const t = setup();
    t.client.start();
    t.src().open();
    t.src().fail();
    expect(t.client.state()).toBe("connecting");
    t.clock.advance(3000);
    t.src().open();
    expect(t.client.state()).toBe("live");
    expect(t.onResync).toHaveBeenCalledTimes(1);
    t.src().emit("hello", "{}");
    expect(t.onResync).toHaveBeenCalledTimes(1);
  });

  it("goes offline after 10 s without being live, then polls every 15 s until live", () => {
    const t = setup();
    t.client.start();
    t.src().open();
    t.src().fail();
    t.clock.advance(9_999);
    expect(t.client.state()).toBe("connecting");
    t.clock.advance(1);
    expect(t.client.state()).toBe("offline");
    expect(t.onResync).not.toHaveBeenCalled();
    t.clock.advance(15_000);
    expect(t.onResync).toHaveBeenCalledTimes(1);
    t.clock.advance(15_000);
    expect(t.onResync).toHaveBeenCalledTimes(2);
    t.src().open(); // browser reconnected
    expect(t.client.state()).toBe("live");
    expect(t.onResync).toHaveBeenCalledTimes(3); // reconnect resync
    t.clock.advance(60_000);
    expect(t.onResync).toHaveBeenCalledTimes(3); // fallback poll stopped
  });

  it("a never-successful first connection also goes offline after 10 s", () => {
    const t = setup();
    t.client.start();
    t.src().fail();
    t.clock.advance(10_000);
    expect(t.client.state()).toBe("offline");
    t.src().open();
    expect(t.onResync).toHaveBeenCalledTimes(1); // we were failing before: refetch
  });

  it("reopens a source the browser gave up on (readyState CLOSED) after the retry delay", () => {
    const t = setup();
    t.client.start();
    t.src().open();
    const first = t.src();
    first.fail(true);
    expect(first.closed).toBe(true);
    expect(FakeSource.all).toHaveLength(1);
    t.clock.advance(3000);
    expect(FakeSource.all).toHaveLength(2);
    t.src().open();
    expect(t.client.state()).toBe("live");
    expect(t.onResync).toHaveBeenCalledTimes(1);
  });

  it("notifies state changes once each", () => {
    const t = setup();
    t.client.start();
    t.src().open();
    t.src().fail();
    t.src().fail();
    t.clock.advance(10_000);
    t.src().open();
    expect(t.states).toEqual(["connecting", "live", "connecting", "offline", "live"]);
  });

  it("stop closes the source, cancels every timer and silences callbacks", () => {
    const t = setup();
    t.client.start();
    t.src().open();
    t.src().fail();
    t.clock.advance(10_000);
    const s = t.src();
    t.client.stop();
    expect(s.closed).toBe(true);
    expect(t.clock.pending()).toBe(0);
    s.emit("orders", JSON.stringify(ev));
    s.open();
    t.clock.advance(100_000);
    expect(t.onOrders).not.toHaveBeenCalled();
    expect(t.onResync).not.toHaveBeenCalled();
  });

  it("start is idempotent", () => {
    const t = setup();
    t.client.start();
    t.client.start();
    expect(FakeSource.all).toHaveLength(1);
  });
});

describe("auth loss (source ends CLOSED again and again)", () => {
  it("reopens with escalating backoff 3, 6, 12, 24, 48, 60 s and resets after an open", () => {
    const t = setup();
    t.client.start();
    const delays = [3_000, 6_000, 12_000, 24_000, 48_000, 60_000, 60_000];
    for (const [i, d] of delays.entries()) {
      t.src().fail(true);
      t.clock.advance(d - 1);
      expect(FakeSource.all).toHaveLength(i + 1);
      t.clock.advance(1);
      expect(FakeSource.all).toHaveLength(i + 2);
    }
    t.src().open();
    t.src().fail(true);
    t.clock.advance(3_000);
    expect(FakeSource.all).toHaveLength(delays.length + 2);
  });

  it("stops the fallback poll after 5 consecutive CLOSED failures and shows offline", () => {
    const t = setup();
    t.client.start();
    for (const d of [3_000, 6_000, 12_000, 24_000]) {
      t.src().fail(true);
      t.clock.advance(d);
    }
    t.clock.advance(0);
    const polledSoFar = t.onResync.mock.calls.length;
    t.src().fail(true); // 5th
    expect(t.client.state()).toBe("offline");
    t.clock.advance(300_000);
    expect(t.onResync.mock.calls.length).toBe(polledSoFar);
    t.src().open(); // eventually recovers
    expect(t.client.state()).toBe("live");
    expect(t.onResync).toHaveBeenCalledTimes(polledSoFar + 1);
  });
});
