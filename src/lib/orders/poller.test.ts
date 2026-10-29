import { describe, expect, it, vi } from "vitest";
import { backoffDelay, createPoller, hasChanged, isTerminal, MAX_BACKOFF_MS, POLL_INTERVAL_MS, type PollResult } from "./poller";

/** Deterministic clock: timers fire only when the test advances time. */
function fakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const flush = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  return {
    schedule: (fn: () => void, ms: number) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    cancel: (id: unknown) => void timers.delete(id as number),
    pending: () => timers.size,
    async advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at;
        timers.delete(due[0]);
        due[1].fn();
        await flush();
      }
      now = end;
      await flush();
    },
  };
}

const ok = (status: string, paymentStatus = "pending"): PollResult => ({
  kind: "ok",
  status: status as never,
  paymentStatus: paymentStatus as never,
});

function setup(opts: { visible?: boolean; initial?: string; results?: (PollResult | Error)[] } = {}) {
  const clock = fakeClock();
  let visible = opts.visible ?? true;
  const queue = [...(opts.results ?? [])];
  const fetchStatus = vi.fn(async (): Promise<PollResult> => {
    const next = queue.shift() ?? ok(opts.initial ?? "pendiente_aprobacion");
    if (next instanceof Error) throw next;
    return next;
  });
  const onChange = vi.fn();
  const poller = createPoller({
    initial: { status: (opts.initial ?? "pendiente_aprobacion") as never, paymentStatus: "pending" },
    fetchStatus,
    onChange,
    isVisible: () => visible,
    schedule: clock.schedule,
    cancel: clock.cancel,
  });
  return { clock, poller, fetchStatus, onChange, setVisible: (v: boolean) => (visible = v) };
}

describe("backoffDelay", () => {
  it("is the base interval without failures, then doubles, capped at 60 s", () => {
    expect(POLL_INTERVAL_MS).toBe(8000);
    expect(MAX_BACKOFF_MS).toBe(60000);
    expect([0, 1, 2, 3, 4, 10, 1000].map(backoffDelay)).toEqual([8000, 16000, 32000, 60000, 60000, 60000, 60000]);
  });
});

describe("isTerminal", () => {
  it("only entregado and cancelado", () => {
    expect(isTerminal("entregado")).toBe(true);
    expect(isTerminal("cancelado")).toBe(true);
    for (const s of ["pendiente_aprobacion", "en_preparacion", "listo_despacho", "en_camino", "para_retirar"]) {
      expect(isTerminal(s as never)).toBe(false);
    }
  });
});

describe("createPoller", () => {
  it("polls every 8 s while visible", async () => {
    const { clock, poller, fetchStatus } = setup();
    poller.start();
    await clock.advance(7999);
    expect(fetchStatus).toHaveBeenCalledTimes(0);
    await clock.advance(1);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    await clock.advance(8000);
    expect(fetchStatus).toHaveBeenCalledTimes(2);
    await clock.advance(16000);
    expect(fetchStatus).toHaveBeenCalledTimes(4);
  });

  it("does not poll while hidden, and refreshes immediately when it becomes visible", async () => {
    const { clock, poller, fetchStatus, setVisible } = setup({ visible: false });
    poller.start();
    await clock.advance(60000);
    expect(fetchStatus).not.toHaveBeenCalled();
    setVisible(true);
    poller.visibilityChanged();
    await clock.advance(0);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    await clock.advance(8000);
    expect(fetchStatus).toHaveBeenCalledTimes(2);
  });

  it("pauses when the tab is hidden (pending timer cancelled)", async () => {
    const { clock, poller, fetchStatus, setVisible } = setup();
    poller.start();
    await clock.advance(8000);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    setVisible(false);
    poller.visibilityChanged();
    expect(clock.pending()).toBe(0);
    await clock.advance(60000);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
  });

  it("a response that lands while hidden is applied but does not reschedule", async () => {
    let resolve!: (r: PollResult) => void;
    const clock = fakeClock();
    let visible = true;
    const onChange = vi.fn();
    const fetchStatus = vi.fn(() => new Promise<PollResult>((r) => (resolve = r)));
    const poller = createPoller({
      initial: { status: "pendiente_aprobacion", paymentStatus: "pending" },
      fetchStatus,
      onChange,
      isVisible: () => visible,
      schedule: clock.schedule,
      cancel: clock.cancel,
    });
    poller.start();
    await clock.advance(8000);
    visible = false;
    poller.visibilityChanged();
    resolve(ok("en_preparacion"));
    await clock.advance(0);
    expect(onChange).toHaveBeenCalledWith({ status: "en_preparacion", paymentStatus: "pending" });
    expect(clock.pending()).toBe(0);
  });

  it("online triggers an immediate poll; not while hidden", async () => {
    const { clock, poller, fetchStatus, setVisible } = setup();
    poller.start();
    poller.online();
    await clock.advance(0);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    setVisible(false);
    poller.online();
    await clock.advance(0);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
  });

  it("never runs two requests at once", async () => {
    let resolve!: (r: PollResult) => void;
    const clock = fakeClock();
    const fetchStatus = vi.fn(() => new Promise<PollResult>((r) => (resolve = r)));
    const poller = createPoller({
      initial: { status: "pendiente_aprobacion", paymentStatus: "pending" },
      fetchStatus,
      onChange: vi.fn(),
      isVisible: () => true,
      schedule: clock.schedule,
      cancel: clock.cancel,
    });
    poller.start();
    await clock.advance(8000);
    poller.online();
    poller.visibilityChanged();
    await clock.advance(0);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    resolve(ok("pendiente_aprobacion"));
    await clock.advance(0); // the response lands and schedules the next poll
    await clock.advance(8000);
    expect(fetchStatus).toHaveBeenCalledTimes(2);
  });

  it("reports a change (status or payment) once and keeps polling", async () => {
    const { clock, poller, onChange } = setup({
      results: [ok("pendiente_aprobacion"), ok("en_preparacion"), ok("en_preparacion"), ok("en_preparacion", "paid")],
    });
    poller.start();
    await clock.advance(8000);
    expect(onChange).not.toHaveBeenCalled();
    await clock.advance(8000);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith({ status: "en_preparacion", paymentStatus: "pending" });
    await clock.advance(8000);
    expect(onChange).toHaveBeenCalledTimes(1);
    await clock.advance(8000);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith({ status: "en_preparacion", paymentStatus: "paid" });
  });

  it("stops for good after a terminal status", async () => {
    const { clock, poller, fetchStatus, onChange } = setup({ results: [ok("entregado")] });
    poller.start();
    await clock.advance(8000);
    expect(onChange).toHaveBeenCalledWith({ status: "entregado", paymentStatus: "pending" });
    expect(clock.pending()).toBe(0);
    poller.online();
    poller.visibilityChanged();
    await clock.advance(120000);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
  });

  it("does not even start when the order is already terminal", async () => {
    for (const initial of ["entregado", "cancelado"]) {
      const { clock, poller, fetchStatus } = setup({ initial });
      poller.start();
      poller.online();
      await clock.advance(120000);
      expect(fetchStatus).not.toHaveBeenCalled();
    }
  });

  it("backs off exponentially on errors (capped at 60 s) and resets after a success", async () => {
    const boom = new Error("net");
    const { clock, poller, fetchStatus } = setup({
      results: [boom, boom, boom, boom, boom, ok("pendiente_aprobacion")],
    });
    poller.start();
    await clock.advance(8000); // failure 1 -> next in 16 s
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    await clock.advance(15999);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    await clock.advance(1); // failure 2 -> 32 s
    expect(fetchStatus).toHaveBeenCalledTimes(2);
    await clock.advance(32000); // failure 3 -> 60 s
    expect(fetchStatus).toHaveBeenCalledTimes(3);
    await clock.advance(59999);
    expect(fetchStatus).toHaveBeenCalledTimes(3);
    await clock.advance(1); // failure 4 -> still 60 s
    expect(fetchStatus).toHaveBeenCalledTimes(4);
    await clock.advance(60000); // failure 5 -> 60 s
    expect(fetchStatus).toHaveBeenCalledTimes(5);
    await clock.advance(60000); // success -> back to 8 s
    expect(fetchStatus).toHaveBeenCalledTimes(6);
    await clock.advance(8000);
    expect(fetchStatus).toHaveBeenCalledTimes(7);
  });

  it("an error result (non-2xx) backs off like a thrown error", async () => {
    const { clock, poller, fetchStatus } = setup({ results: [{ kind: "error" }, ok("pendiente_aprobacion")] });
    poller.start();
    await clock.advance(8000);
    await clock.advance(15999);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    await clock.advance(1);
    expect(fetchStatus).toHaveBeenCalledTimes(2);
  });

  it("a 404 (order gone) stops polling", async () => {
    const { clock, poller, fetchStatus } = setup({ results: [{ kind: "gone" }] });
    poller.start();
    await clock.advance(8000);
    await clock.advance(120000);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
  });

  it("stop() cancels everything", async () => {
    const { clock, poller, fetchStatus, onChange } = setup({ results: [ok("en_preparacion")] });
    poller.start();
    await clock.advance(8000);
    poller.stop();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(clock.pending()).toBe(0);
    poller.online();
    await clock.advance(120000);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
  });

  it("start() twice does not double the polling", async () => {
    const { clock, poller, fetchStatus } = setup();
    poller.start();
    poller.start();
    await clock.advance(8000);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
  });
});

describe("hasChanged (version token)", () => {
  const base = { status: "en_preparacion", paymentStatus: "paid", updatedAt: "2026-10-15T12:00:00.000Z" } as never;
  it("an updatedAt change alone is a change", () => {
    expect(hasChanged(base, { ...(base as object), updatedAt: "2026-10-15T12:05:00.000Z" } as never)).toBe(true);
  });
  it("an identical payload is not", () => {
    expect(hasChanged(base, { ...(base as object) } as never)).toBe(false);
  });
});

describe("poller with updatedAt", () => {
  it("refreshes when only updatedAt moves, and not when identical", async () => {
    const clock = fakeClock();
    const mk = (updatedAt: string): PollResult => ({ kind: "ok", status: "en_preparacion" as never, paymentStatus: "paid" as never, updatedAt });
    const queue = [mk("t0"), mk("t1")];
    const onChange = vi.fn();
    const poller = createPoller({
      initial: { status: "en_preparacion" as never, paymentStatus: "paid", updatedAt: "t0" },
      fetchStatus: async () => queue.shift()!,
      onChange,
      isVisible: () => true,
      schedule: clock.schedule,
      cancel: clock.cancel,
    });
    poller.start();
    await clock.advance(POLL_INTERVAL_MS);
    expect(onChange).not.toHaveBeenCalled();
    await clock.advance(POLL_INTERVAL_MS);
    expect(onChange).toHaveBeenCalledTimes(1);
    poller.stop();
  });
});
