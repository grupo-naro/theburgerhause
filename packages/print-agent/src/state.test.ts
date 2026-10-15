import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_PENDING_ACKS, MAX_PRINTED, StateStore } from "./state";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-state-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const file = () => path.join(dir, "state.json");
const now = () => new Date("2026-10-15T10:00:00.000Z");

describe("StateStore", () => {
  it("starts empty when there is no file", () => {
    const s = StateStore.load(dir, now);
    expect(s.hasPrinted(1)).toBe(false);
    expect(s.pendingAcks()).toEqual([]);
  });

  it("persists printed ids across instances", () => {
    const s = StateStore.load(dir, now);
    s.markPrinted(7);
    s.markPrinted(8);
    const again = StateStore.load(dir, now);
    expect(again.hasPrinted(7)).toBe(true);
    expect(again.hasPrinted(8)).toBe(true);
    expect(again.hasPrinted(9)).toBe(false);
    expect(JSON.parse(fs.readFileSync(file(), "utf8")).printed[0]).toEqual({ id: 7, at: "2026-10-15T10:00:00.000Z" });
  });

  it("keeps only the last 500 printed ids (oldest evicted)", () => {
    const s = StateStore.load(dir, now);
    for (let i = 1; i <= MAX_PRINTED + 25; i++) s.markPrinted(i);
    const again = StateStore.load(dir, now);
    expect(again.hasPrinted(1)).toBe(false);
    expect(again.hasPrinted(25)).toBe(false);
    expect(again.hasPrinted(26)).toBe(true);
    expect(again.hasPrinted(MAX_PRINTED + 25)).toBe(true);
    expect(MAX_PRINTED).toBe(500);
  });

  it("marking an id twice does not duplicate it", () => {
    const s = StateStore.load(dir, now);
    s.markPrinted(3);
    s.markPrinted(3);
    expect(JSON.parse(fs.readFileSync(file(), "utf8")).printed).toHaveLength(1);
  });

  it("queues acks, one per job, and a done ack replaces a failed one", () => {
    const s = StateStore.load(dir, now);
    s.enqueueAck({ jobId: 5, status: "failed", error: "Sin papel" });
    s.enqueueAck({ jobId: 6, status: "done" });
    s.enqueueAck({ jobId: 5, status: "done" });
    expect(StateStore.load(dir, now).pendingAcks()).toEqual([
      { jobId: 6, status: "done", queuedAt: "2026-10-15T10:00:00.000Z", attempts: 0 },
      { jobId: 5, status: "done", queuedAt: "2026-10-15T10:00:00.000Z", attempts: 0 },
    ]);
    s.enqueueAck({ jobId: 5, status: "failed", error: "x" }); // a failed never downgrades a queued done
    expect(s.pendingAcks().find((a) => a.jobId === 5)?.status).toBe("done");
  });

  it("removes delivered acks and counts attempts", () => {
    const s = StateStore.load(dir, now);
    s.enqueueAck({ jobId: 1, status: "done" });
    s.recordAckAttempt(1);
    s.recordAckAttempt(1);
    expect(StateStore.load(dir, now).pendingAcks()[0].attempts).toBe(2);
    s.removeAck(1);
    expect(StateStore.load(dir, now).pendingAcks()).toEqual([]);
  });

  it("bounds the ack queue, dropping the oldest", () => {
    const s = StateStore.load(dir, now);
    for (let i = 1; i <= MAX_PENDING_ACKS + 5; i++) s.enqueueAck({ jobId: i, status: "done" });
    const acks = StateStore.load(dir, now).pendingAcks();
    expect(acks).toHaveLength(MAX_PENDING_ACKS);
    expect(acks[0].jobId).toBe(6);
  });

  it("truncates a long error message", () => {
    const s = StateStore.load(dir, now);
    s.enqueueAck({ jobId: 1, status: "failed", error: "e".repeat(1000) });
    expect(s.pendingAcks()[0].error).toHaveLength(300);
  });

  it("tolerates a corrupt file: starts clean and keeps the bad file aside", () => {
    fs.writeFileSync(file(), "{not json");
    const s = StateStore.load(dir, now);
    expect(s.hasPrinted(1)).toBe(false);
    expect(fs.readdirSync(dir).some((f) => f.startsWith("state.corrupt-"))).toBe(true);
    s.markPrinted(1);
    expect(StateStore.load(dir, now).hasPrinted(1)).toBe(true);
  });

  it("tolerates a file with the wrong shape or junk entries", () => {
    fs.writeFileSync(file(), JSON.stringify({ printed: [{ id: 4, at: "x" }, { id: "no" }, null, 9], pendingAcks: [{ jobId: 2, status: "done", queuedAt: "t", attempts: 0 }, { jobId: 3, status: "weird" }, 5] }));
    const s = StateStore.load(dir, now);
    expect(s.hasPrinted(4)).toBe(true);
    expect(s.pendingAcks().map((a) => a.jobId)).toEqual([2]);
    fs.writeFileSync(file(), "[]");
    expect(StateStore.load(dir, now).pendingAcks()).toEqual([]);
  });

  it("writes atomically (temp file + rename) and leaves no temp file behind", () => {
    const s = StateStore.load(dir, now);
    for (let i = 0; i < 20; i++) s.markPrinted(i + 1);
    expect(fs.readdirSync(dir).filter((f) => f.includes(".tmp"))).toEqual([]);
    expect(() => JSON.parse(fs.readFileSync(file(), "utf8"))).not.toThrow();
  });

  it("ignores a stale temp file from a crashed write", () => {
    fs.writeFileSync(file(), JSON.stringify({ printed: [{ id: 1, at: "t" }], pendingAcks: [] }));
    fs.writeFileSync(path.join(dir, "state.json.tmp"), "{partial");
    const s = StateStore.load(dir, now);
    expect(s.hasPrinted(1)).toBe(true);
    s.markPrinted(2);
    expect(StateStore.load(dir, now).hasPrinted(2)).toBe(true);
  });

  it("creates the data directory when missing", () => {
    const nested = path.join(dir, "a", "b");
    const s = StateStore.load(nested, now);
    s.markPrinted(1);
    expect(fs.existsSync(path.join(nested, "state.json"))).toBe(true);
  });

  it("reports a persistence failure instead of throwing, and keeps working in memory", () => {
    const s = StateStore.load(dir, now);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.writeFileSync(dir, "i am a file, not a directory");
    expect(() => s.markPrinted(1)).not.toThrow();
    expect(s.hasPrinted(1)).toBe(true);
    expect(s.lastError).toBeTruthy();
    fs.rmSync(dir, { force: true });
  });
});

describe("StateStore.removeAck with a status guard", () => {
  it("a delivered failed ack does not remove a newer done ack for the same job", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "agent-state-"));
    const s = StateStore.load(d, now);
    s.enqueueAck({ jobId: 5, status: "failed", error: "x" });
    s.enqueueAck({ jobId: 5, status: "done" }); // replaced while the failed one was in flight
    s.removeAck(5, "failed");
    expect(s.pendingAcks().map((a) => a.status)).toEqual(["done"]);
    s.removeAck(5, "done");
    expect(s.pendingAcks()).toEqual([]);
    fs.rmSync(d, { recursive: true, force: true });
  });
});

describe("StateStore save failures are surfaced", () => {
  function setup() {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "agent-state-"));
    const calls: { level: string; msg: string; fields?: Record<string, unknown> }[] = [];
    const logger = {
      error: (msg: string, fields?: Record<string, unknown>) => void calls.push({ level: "error", msg, fields }),
      info: (msg: string, fields?: Record<string, unknown>) => void calls.push({ level: "info", msg, fields }),
    };
    let t = Date.parse("2026-10-15T10:00:00.000Z");
    const clock = () => new Date(t);
    const s = StateStore.load(d, clock, logger);
    const breakDir = () => {
      fs.rmSync(d, { recursive: true, force: true });
      fs.writeFileSync(d, "now a file, so nothing can be saved");
    };
    const fixDir = () => {
      fs.rmSync(d, { force: true });
      fs.mkdirSync(d);
    };
    return { d, s, calls, advance: (ms: number) => void (t += ms), breakDir, fixDir };
  }

  it("logs an ERROR when a save fails, at most once per minute, and keeps working in memory", () => {
    const { d, s, calls, advance, breakDir } = setup();
    breakDir();
    s.markPrinted(1);
    s.enqueueAck({ jobId: 1, status: "done" });
    s.markPrinted(2);
    expect(calls.filter((c) => c.level === "error")).toHaveLength(1);
    expect(calls[0].msg).toContain("No se pudo guardar el estado");
    expect(s.hasPrinted(2)).toBe(true);
    advance(59_000);
    s.markPrinted(3);
    expect(calls.filter((c) => c.level === "error")).toHaveLength(1);
    advance(2_000);
    s.markPrinted(4);
    expect(calls.filter((c) => c.level === "error")).toHaveLength(2);
    fs.rmSync(d, { force: true });
  });

  it("never puts ids, documents or tokens in the message", () => {
    const { d, s, calls, breakDir } = setup();
    breakDir();
    s.markPrinted(987654);
    s.enqueueAck({ jobId: 987655, status: "failed", error: "SECRETO bhst_AAAAAAAAAAAAAAAAAAAA" });
    expect(JSON.stringify(calls)).not.toMatch(/987654|SECRETO|bhst_/);
    fs.rmSync(d, { force: true });
  });

  it("logs once when saving works again", () => {
    const { d, s, calls, breakDir, fixDir } = setup();
    breakDir();
    s.markPrinted(1);
    fixDir();
    s.markPrinted(2);
    s.markPrinted(3);
    expect(calls.map((c) => c.level)).toEqual(["error", "info"]);
    expect(calls[1].msg).toContain("volvió a funcionar");
    expect(StateStore.load(d, now).hasPrinted(3)).toBe(true);
  });

  it("works without a logger", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "agent-state-"));
    const s = StateStore.load(d, now);
    fs.rmSync(d, { recursive: true, force: true });
    fs.writeFileSync(d, "x");
    expect(() => s.markPrinted(1)).not.toThrow();
    fs.rmSync(d, { force: true });
  });
});
