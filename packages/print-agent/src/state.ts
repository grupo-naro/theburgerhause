import fs from "node:fs";
import path from "node:path";

export const MAX_PRINTED = 500;
export const MAX_PENDING_ACKS = 1000;
const MAX_ERROR = 300;

export type PrintedEntry = { id: number; at: string };
export type PendingAck = { jobId: number; status: "done" | "failed"; error?: string; queuedAt: string; attempts: number };

const isId = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n > 0;
const isObject = (o: unknown): o is Record<string, unknown> => typeof o === "object" && o !== null && !Array.isArray(o);

/**
 * Persistent agent state in DATA_DIR/state.json: the last 500 printed job ids (so a restart never
 * prints the same job twice) and the acks the server has not received yet. Writes are atomic
 * (temp file + rename); a missing or corrupt file just starts clean.
 */
export class StateStore {
  lastError: string | null = null;

  private constructor(
    private readonly dir: string,
    private readonly now: () => Date,
    private printed: PrintedEntry[],
    private acks: PendingAck[],
  ) {}

  static load(dir: string, now: () => Date = () => new Date()): StateStore {
    const file = path.join(dir, "state.json");
    let printed: PrintedEntry[] = [];
    let acks: PendingAck[] = [];
    let raw: string | null = null;
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch {
      raw = null; // missing: first run
    }
    if (raw !== null) {
      try {
        const data: unknown = JSON.parse(raw.replace(/^﻿/, ""));
        if (!isObject(data)) throw new Error("shape");
        if (Array.isArray(data.printed)) {
          printed = data.printed
            .filter((e): e is Record<string, unknown> => isObject(e) && isId(e.id))
            .map((e) => ({ id: e.id as number, at: typeof e.at === "string" ? e.at : "" }))
            .slice(-MAX_PRINTED);
        }
        if (Array.isArray(data.pendingAcks)) {
          acks = data.pendingAcks
            .filter((a): a is Record<string, unknown> => isObject(a) && isId(a.jobId) && (a.status === "done" || a.status === "failed"))
            .map((a) => ({
              jobId: a.jobId as number,
              status: a.status as "done" | "failed",
              ...(typeof a.error === "string" ? { error: a.error.slice(0, MAX_ERROR) } : {}),
              queuedAt: typeof a.queuedAt === "string" ? a.queuedAt : "",
              attempts: typeof a.attempts === "number" && a.attempts >= 0 ? a.attempts : 0,
            }))
            .slice(-MAX_PENDING_ACKS);
        }
      } catch {
        try {
          fs.renameSync(file, path.join(dir, `state.corrupt-${now().getTime()}.json`));
        } catch {
          // keep going with a clean state
        }
      }
    }
    return new StateStore(dir, now, printed, acks);
  }

  hasPrinted(id: number): boolean {
    return this.printed.some((e) => e.id === id);
  }

  markPrinted(id: number): void {
    if (!this.hasPrinted(id)) {
      this.printed.push({ id, at: this.now().toISOString() });
      if (this.printed.length > MAX_PRINTED) this.printed = this.printed.slice(-MAX_PRINTED);
    }
    this.save();
  }

  pendingAcks(): PendingAck[] {
    return this.acks.map((a) => ({ ...a }));
  }

  /** One entry per job: a later ack replaces the earlier one, except that a failed never replaces a done. */
  enqueueAck(ack: { jobId: number; status: "done" | "failed"; error?: string }): void {
    const existing = this.acks.find((a) => a.jobId === ack.jobId);
    if (existing?.status === "done" && ack.status === "failed") return;
    this.acks = this.acks.filter((a) => a.jobId !== ack.jobId);
    this.acks.push({
      jobId: ack.jobId,
      status: ack.status,
      ...(ack.error ? { error: ack.error.slice(0, MAX_ERROR) } : {}),
      queuedAt: this.now().toISOString(),
      attempts: 0,
    });
    if (this.acks.length > MAX_PENDING_ACKS) this.acks = this.acks.slice(-MAX_PENDING_ACKS);
    this.save();
  }

  recordAckAttempt(jobId: number): void {
    const a = this.acks.find((x) => x.jobId === jobId);
    if (a) {
      a.attempts++;
      this.save();
    }
  }

  removeAck(jobId: number): void {
    const before = this.acks.length;
    this.acks = this.acks.filter((a) => a.jobId !== jobId);
    if (this.acks.length !== before) this.save();
  }

  private save(): void {
    const file = path.join(this.dir, "state.json");
    const tmp = `${file}.tmp`;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, printed: this.printed, pendingAcks: this.acks }));
      renameWithRetry(tmp, file);
      this.lastError = null;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        // nothing else to do
      }
    }
  }
}

/** On Windows an antivirus or indexer can briefly lock the target; retry a few times. */
function renameWithRetry(from: string, to: string): void {
  for (let i = 0; ; i++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (i >= 5 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * (i + 1));
    }
  }
}
