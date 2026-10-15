import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "./logger";
import { PrintError } from "./printer/types";
import { StateStore } from "./state";
import { toEscPos } from "./escpos";
import type { AckSink } from "./ack";
import type { AgentJob } from "./protocol";
import { JobWorker } from "./worker";
import { CaptureLog, FakeBackend, FakeClock, sampleDocument, tmpDir, waitUntil } from "./testing/support";
import { EventEmitter } from "node:events";

let dir: string;
let state: StateStore;
let backend: FakeBackend;
let clock: FakeClock;
let log: CaptureLog;
let acks: (Parameters<AckSink["submit"]>[0] & { printedAtSubmit: boolean })[];
const acksChanged = new EventEmitter();

beforeEach(() => {
  dir = tmpDir();
  state = StateStore.load(dir);
  backend = new FakeBackend();
  clock = new FakeClock();
  log = new CaptureLog();
  acks = [];
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const sink: AckSink = {
  submit(a) {
    acks.push({ ...a, printedAtSubmit: state.hasPrinted(a.jobId) });
    acksChanged.emit("change");
  },
};
const make = (over: { paperWidth?: 58 | 80 } = {}) =>
  new JobWorker({ backend, state, acks: sink, clock, logger: createLogger({ level: "debug", sinks: [log.sink] }), codepage: "cp858", paperWidth: over.paperWidth ?? 80, printTimeoutMs: 20_000 });
const job = (id: number, document: unknown = sampleDocument(`PEDIDO ${id}`)): AgentJob => ({ id, type: "kitchen", attempts: 1, createdAt: "", document });
const waitAcks = (n: number) => waitUntil(() => acks.length >= n, [acksChanged], `${n} acks`);

describe("JobWorker", () => {
  it("prints the ESC/POS translation once, persists the printed id, then acks done", async () => {
    const w = make();
    w.enqueue(job(1));
    await waitAcks(1);
    expect(backend.prints).toHaveLength(1);
    expect(backend.prints[0].bytes).toEqual(toEscPos(sampleDocument("PEDIDO 1") as never, { paperWidth: 80, codepage: "cp858" }));
    expect(backend.prints[0].jobId).toBe(1);
    expect(acks).toEqual([{ jobId: 1, status: "done", printedAtSubmit: true }]); // the id was persisted BEFORE the ack
    expect(StateStore.load(dir).hasPrinted(1)).toBe(true);
  });

  it("uses the configured paper width", async () => {
    make({ paperWidth: 58 }).enqueue(job(1));
    await waitAcks(1);
    expect(backend.prints[0].bytes.toString("latin1")).toContain("-".repeat(32) + "\n");
    expect(backend.prints[0].bytes.toString("latin1")).not.toContain("-".repeat(33));
  });

  it("a job delivered twice prints ONCE and is acked done for each delivery", async () => {
    const w = make();
    w.enqueue(job(7));
    w.enqueue(job(7));
    await waitAcks(2);
    expect(backend.prints).toHaveLength(1);
    expect(acks.map((a) => [a.jobId, a.status])).toEqual([[7, "done"], [7, "done"]]);
  });

  it("an id already printed in a previous run is never printed again (redelivered after a lost ack)", async () => {
    state.markPrinted(11);
    const w = make();
    w.enqueue(job(11));
    await waitAcks(1);
    expect(backend.prints).toHaveLength(0);
    expect(acks[0]).toMatchObject({ jobId: 11, status: "done" });
  });

  it("a print error acks failed with the short Spanish message and does NOT mark the job printed", async () => {
    backend.plan = [new PrintError("Sin papel en la impresora")];
    make().enqueue(job(2));
    await waitAcks(1);
    expect(acks[0]).toMatchObject({ jobId: 2, status: "failed", error: "Sin papel en la impresora" });
    expect(state.hasPrinted(2)).toBe(false);
  });

  it("an unexpected error is reported generically (no stack, no internals) and logged", async () => {
    backend.plan = [new Error("EPERM C:\\Users\\secret\\x.bin at Object.<anonymous>")];
    make().enqueue(job(3));
    await waitAcks(1);
    expect(acks[0]).toMatchObject({ jobId: 3, status: "failed", error: "Error de impresión" });
    expect(log.lines.some((l) => l.includes("ERROR"))).toBe(true);
  });

  it("a redelivered job that failed before IS printed on the next delivery", async () => {
    backend.plan = [new PrintError("Sin papel"), "ok"];
    const w = make();
    w.enqueue(job(4));
    await waitAcks(1);
    w.enqueue(job(4));
    await waitAcks(2);
    expect(acks.map((a) => a.status)).toEqual(["failed", "done"]);
    expect(backend.prints).toHaveLength(2);
  });

  it("a document that fails the schema is acked failed 'documento inválido' without printing", async () => {
    const w = make();
    for (const bad of [null, { blocks: "x" }, { blocks: [{ type: "text" }] }, { blocks: [{ type: "text", text: "x".repeat(2001) }] }, { blocks: Array(501).fill({ type: "divider" }) }]) w.enqueue(job(5, bad));
    await waitAcks(5);
    expect(backend.prints).toHaveLength(0);
    expect(acks.every((a) => a.status === "failed" && a.error === "documento inválido")).toBe(true);
  });

  it("processes one job at a time, in arrival order", async () => {
    backend.plan = ["hang", "ok", "ok"];
    const w = make();
    w.enqueue(job(1));
    w.enqueue(job(2));
    w.enqueue(job(3));
    await waitUntil(() => backend.prints.length === 1, [backend], "first print");
    await Promise.resolve();
    expect(backend.prints.map((p) => p.jobId)).toEqual([1]); // 2 and 3 wait for 1
    backend.release();
    await waitAcks(3);
    expect(backend.prints.map((p) => p.jobId)).toEqual([1, 2, 3]);
    expect(acks.map((a) => a.jobId)).toEqual([1, 2, 3]);
  });

  it("a print that exceeds 20 s is acked failed 'La impresora no respondió a tiempo'", async () => {
    backend.plan = ["hang"];
    make().enqueue(job(6));
    await clock.waitForTimer("print-timeout");
    expect(clock.pending("print-timeout")[0].ms).toBe(20_000);
    await clock.fire("print-timeout");
    await waitAcks(1);
    expect(acks[0]).toMatchObject({ jobId: 6, status: "failed", error: "La impresora no respondió a tiempo" });
    expect(state.hasPrinted(6)).toBe(false);
  });

  it("if a timed-out print finally completes, the job is recorded as printed and acked done (no re-print later)", async () => {
    backend.plan = ["hang"];
    const w = make();
    w.enqueue(job(6));
    await clock.fire("print-timeout");
    await waitAcks(1);
    backend.release();
    await waitAcks(2);
    expect(acks[1]).toMatchObject({ jobId: 6, status: "done", printedAtSubmit: true });
    w.enqueue(job(6)); // the server redelivers it after the failed ack
    await waitAcks(3);
    expect(backend.prints).toHaveLength(1);
  });

  it("the timeout timer is cancelled when the print finishes in time", async () => {
    make().enqueue(job(1));
    await waitAcks(1);
    expect(clock.pending("print-timeout")).toEqual([]);
  });

  it("drain() lets the in-flight job finish, acks it, and drops the jobs that had not started", async () => {
    backend.plan = ["hang", "ok"];
    const w = make();
    w.enqueue(job(1));
    w.enqueue(job(2));
    await waitUntil(() => backend.prints.length === 1, [backend], "first print");
    const drained = w.drain();
    backend.release();
    await drained;
    expect(acks.map((a) => [a.jobId, a.status])).toEqual([[1, "done"]]);
    expect(backend.prints.map((p) => p.jobId)).toEqual([1]);
    w.enqueue(job(3)); // after drain nothing more is accepted
    await Promise.resolve();
    expect(backend.prints).toHaveLength(1);
  });

  it("never logs the document contents", async () => {
    const w = make();
    w.enqueue(job(1, sampleDocument("DATO PRIVADO DEL CLIENTE")));
    await waitAcks(1);
    expect(log.lines.length).toBeGreaterThan(0);
    expect(log.lines.join("\n")).not.toContain("DATO PRIVADO");
  });
});
