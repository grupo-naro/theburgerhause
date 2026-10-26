import { describe, expect, it, vi } from "vitest";
import { queueReprints, reprintsFor } from "./reprint-queue";

describe("reprintsFor", () => {
  it("kitchen first, customer + delivery folded into both, only what is asked", () => {
    expect(reprintsFor(["customer"])).toEqual(["customer"]);
    expect(reprintsFor(["kitchen"])).toEqual(["kitchen"]);
    expect(reprintsFor(["customer", "kitchen"])).toEqual(["kitchen", "customer"]);
    expect(reprintsFor(["delivery", "customer", "kitchen"])).toEqual(["kitchen", "both"]);
    expect(reprintsFor(["delivery"])).toEqual(["delivery"]);
    expect(reprintsFor([])).toEqual([]);
  });
});

describe("queueReprints", () => {
  const ok = { ok: true as const };
  const fail = { ok: false as const, message: "no" };

  it("queues in order and remembers what went through", async () => {
    const queued = new Set<string>();
    const call = vi.fn<(w: string) => Promise<typeof ok>>(async () => ok);
    expect(await queueReprints(["kitchen", "customer"], queued, call)).toEqual(ok);
    expect(call.mock.calls.map((c) => c[0])).toEqual(["kitchen", "customer"]);
    expect([...queued]).toEqual(["kitchen", "customer"]);
  });

  it("a partial failure keeps the queued ones: the retry only queues the rest (no duplicate comanda)", async () => {
    const queued = new Set<string>();
    const call = vi.fn(async (w: string) => (w === "customer" ? fail : ok));
    expect(await queueReprints(["kitchen", "customer"], queued, call)).toEqual(fail);
    expect(call.mock.calls.map((c) => c[0])).toEqual(["kitchen", "customer"]);
    call.mockClear();
    call.mockImplementation(async () => ok);
    expect(await queueReprints(["kitchen", "customer"], queued, call)).toEqual(ok);
    expect(call.mock.calls.map((c) => c[0])).toEqual(["customer"]);
  });

  it("nothing to queue is a success without calls", async () => {
    const call = vi.fn<(w: string) => Promise<typeof ok>>(async () => ok);
    expect(await queueReprints([], new Set(), call)).toEqual(ok);
    expect(call).not.toHaveBeenCalled();
  });
});
