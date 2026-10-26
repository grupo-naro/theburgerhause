import { describe, expect, it } from "vitest";
import type { PrintState } from "@/lib/orders/caja-queries";
import { createPrintPoller, printStatusOf, type PrintPollerDeps } from "./print-poller";

describe("printStatusOf", () => {
  it("failed wins", () => expect(printStatusOf({ pending: 1, failed: 1, done: 0 })).toBe("failed"));
  it("pending -> printing", () => expect(printStatusOf({ pending: 1, failed: 0, done: 1 })).toBe("printing"));
  it("done with nothing pending -> done", () => expect(printStatusOf({ pending: 0, failed: 0, done: 2 })).toBe("done"));
  it("no jobs at all yet -> printing", () => expect(printStatusOf({ pending: 0, failed: 0, done: 0 })).toBe("printing"));
});

function harness(states: (PrintState | "error")[], over: Partial<PrintPollerDeps> = {}) {
  let now = 0;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let nextId = 1;
  const seen: string[] = [];
  let calls = 0;
  const poller = createPrintPoller({
    fetchState: async () => {
      const s = states[Math.min(calls, states.length - 1)];
      calls++;
      if (s === "error") throw new Error("net");
      return s;
    },
    onStatus: (st) => seen.push(st),
    schedule: (fn, ms) => {
      const id = nextId++;
      timers.push({ at: now + ms, fn, id });
      return id;
    },
    cancel: (h) => {
      const i = timers.findIndex((t) => t.id === h);
      if (i >= 0) timers.splice(i, 1);
    },
    now: () => now,
    ...over,
  });
  /** Advances the fake clock by `ms`, firing due timers and flushing promises. */
  async function advance(ms: number) {
    const end = now + ms;
    const flush = async () => {
      for (let i = 0; i < 8; i++) await Promise.resolve();
    };
    for (;;) {
      await flush();
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > end) break;
      timers.shift();
      now = next.at;
      next.fn();
    }
    now = end;
    await flush();
  }
  return { poller, advance, seen, calls: () => calls, timers };
}

describe("createPrintPoller: state handed to the UI", () => {
  it("onStatus also receives the last fetched state (the kinds that failed / are unconfirmed), including on 'waiting'", async () => {
    const seen: [string, unknown][] = [];
    const timers: (() => void)[] = [];
    let now = 0;
    const poller = createPrintPoller({
      fetchState: async () => ({ pending: 1, failed: 0, done: 0, pendingKinds: ["kitchen"] }),
      onStatus: (st, state) => seen.push([st, state]),
      schedule: (fn) => timers.push(fn),
      cancel: () => {},
      now: () => now,
      timeoutMs: 1000,
    });
    poller.start();
    await Promise.resolve();
    await Promise.resolve();
    now = 2000;
    timers.shift()!();
    await Promise.resolve();
    await Promise.resolve();
    expect(seen.at(-1)).toEqual(["waiting", { pending: 1, failed: 0, done: 0, pendingKinds: ["kitchen"] }]);
  });
});

describe("createPrintPoller", () => {
  it("polls immediately on start, then every 2 s", async () => {
    const h = harness([{ pending: 2, failed: 0, done: 0 }]);
    h.poller.start();
    await h.advance(0);
    expect(h.calls()).toBe(1);
    await h.advance(2000);
    expect(h.calls()).toBe(2);
    await h.advance(2000);
    expect(h.calls()).toBe(3);
  });
  it("stops on done", async () => {
    const h = harness([{ pending: 2, failed: 0, done: 0 }, { pending: 0, failed: 0, done: 2 }]);
    h.poller.start();
    await h.advance(10_000);
    expect(h.seen).toEqual(["printing", "done"]);
    expect(h.calls()).toBe(2);
    expect(h.timers).toHaveLength(0);
  });
  it("stops on failed", async () => {
    const h = harness([{ pending: 1, failed: 1, done: 1 }]);
    h.poller.start();
    await h.advance(10_000);
    expect(h.seen).toEqual(["failed"]);
    expect(h.calls()).toBe(1);
  });
  it("reports 'waiting' and stops after the timeout (30 s) while still pending", async () => {
    const h = harness([{ pending: 2, failed: 0, done: 0 }]);
    h.poller.start();
    await h.advance(60_000);
    expect(h.seen[h.seen.length - 1]).toBe("waiting");
    const calls = h.calls();
    await h.advance(60_000);
    expect(h.calls()).toBe(calls);
    expect(calls).toBeLessThanOrEqual(17);
  });
  it("only emits when the status changes", async () => {
    const h = harness([{ pending: 2, failed: 0, done: 0 }]);
    h.poller.start();
    await h.advance(6000);
    expect(h.seen).toEqual(["printing"]);
  });
  it("a failed request is retried on the next tick", async () => {
    const h = harness(["error", { pending: 0, failed: 0, done: 2 }]);
    h.poller.start();
    await h.advance(2500);
    expect(h.seen).toEqual(["done"]);
  });
  it("stop() cancels everything", async () => {
    const h = harness([{ pending: 2, failed: 0, done: 0 }]);
    h.poller.start();
    await h.advance(0);
    h.poller.stop();
    const c = h.calls();
    await h.advance(30_000);
    expect(h.calls()).toBe(c);
    expect(h.timers).toHaveLength(0);
  });
  it("never has two requests in flight", async () => {
    let resolve!: (s: PrintState) => void;
    let calls = 0;
    const h = harness([], {
      fetchState: () => {
        calls++;
        return new Promise<PrintState>((r) => (resolve = r));
      },
    });
    h.poller.start();
    await h.advance(7000);
    expect(calls).toBe(1);
    resolve({ pending: 0, failed: 0, done: 2 });
    await h.advance(0);
    expect(h.seen).toEqual(["done"]);
  });
});
