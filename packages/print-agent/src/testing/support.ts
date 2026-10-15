import { EventEmitter } from "node:events";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import type { Clock, TimerHandle } from "../clock";
import type { LogEntry, LogSink } from "../logger";
import type { PrinterBackend, PrintContext } from "../printer/types";

/** Test helpers only (excluded from the build and the bundle). Everything is event-based: no fixed sleeps. */

export function waitUntil(cond: () => boolean, notifiers: EventEmitter[], what: string, timeoutMs = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (cond()) return resolve();
    const check = () => {
      if (!cond()) return;
      cleanup();
      resolve();
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timeout (${timeoutMs} ms) waiting for ${what}`));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      for (const n of notifiers) n.off("change", check);
    };
    for (const n of notifiers) n.on("change", check);
  });
}

export const settle = () => new Promise<void>((r) => setImmediate(r));

export function tmpDir(prefix = "agent-test-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

type FakeTimer = { id: number; at: number; fn: () => void; label: string; ms: number };

export class FakeClock extends EventEmitter implements Clock {
  private t = 1_000_000;
  private seq = 0;
  private timers: FakeTimer[] = [];

  now(): number {
    return this.t;
  }

  setTimeout(fn: () => void, ms: number, label = ""): TimerHandle {
    const timer: FakeTimer = { id: ++this.seq, at: this.t + ms, fn, label, ms };
    this.timers.push(timer);
    this.emit("change");
    return {
      cancel: () => {
        this.timers = this.timers.filter((x) => x.id !== timer.id);
        this.emit("change");
      },
    };
  }

  pending(label?: string): { ms: number; label: string }[] {
    return this.timers.filter((x) => label === undefined || x.label === label).map((x) => ({ ms: x.at - this.t, label: x.label }));
  }

  waitForTimer(label: string, timeoutMs?: number): Promise<void> {
    return waitUntil(() => this.pending(label).length > 0, [this], `a "${label}" timer`, timeoutMs);
  }

  /** Moves time forward, firing due timers in order. */
  async advance(ms: number): Promise<void> {
    const target = this.t + ms;
    for (;;) {
      const due = this.timers.filter((x) => x.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.t = Math.max(this.t, due.at);
      this.timers = this.timers.filter((x) => x.id !== due.id);
      due.fn();
      await settle();
    }
    this.t = target;
    this.emit("change");
  }

  /** Waits for a timer with this label, returns its delay, and fires it. */
  async fire(label: string): Promise<number> {
    await this.waitForTimer(label);
    const [first] = this.timers.filter((x) => x.label === label).sort((a, b) => a.at - b.at);
    const ms = first.at - this.t;
    await this.advance(ms);
    return first.ms;
  }
}

export class CaptureLog extends EventEmitter {
  entries: LogEntry[] = [];
  lines: string[] = [];
  readonly sink: LogSink = {
    write: (line, entry) => {
      this.lines.push(line);
      this.entries.push(entry);
      this.emit("change");
    },
  };
  has(text: string): boolean {
    return this.lines.some((l) => l.includes(text));
  }
  count(text: string): number {
    return this.lines.filter((l) => l.includes(text)).length;
  }
  waitFor(text: string, timeoutMs?: number): Promise<void> {
    return waitUntil(() => this.has(text), [this], `log "${text}"`, timeoutMs);
  }
}

export class FakeBackend extends EventEmitter implements PrinterBackend {
  prints: { bytes: Buffer; jobId: number }[] = [];
  /** Per-call behaviour: resolve (default), reject with the error, or hang until release(). */
  plan: (("ok" | "hang") | Error)[] = [];
  private hung: (() => void)[] = [];

  async print(bytes: Buffer, ctx: PrintContext): Promise<void> {
    const step = this.plan.shift() ?? "ok";
    this.prints.push({ bytes, jobId: ctx.jobId });
    this.emit("change");
    if (step instanceof Error) throw step;
    if (step === "hang") await new Promise<void>((resolve) => this.hung.push(resolve));
  }
  release(): void {
    for (const r of this.hung.splice(0)) r();
  }
  describe(): string {
    return "fake";
  }
}

export type SentJob = { id: number; type?: string; attempts?: number; createdAt?: string; document?: unknown };

export const sampleDocument = (text = "HOLA") => ({ blocks: [{ type: "text", text, bold: true }, { type: "divider" }, { type: "cut" }] });
export const sampleJob = (id: number, over: Partial<SentJob> = {}): SentJob => ({
  id,
  type: "kitchen",
  attempts: 1,
  createdAt: "2026-10-15T10:00:00.000Z",
  document: sampleDocument(`PEDIDO ${id}`),
  ...over,
});

export class ServerStream {
  closed = false;
  constructor(readonly res: http.ServerResponse) {
    res.on("close", () => {
      this.closed = true;
    });
  }
  sendRaw(s: string): void {
    this.res.write(s);
  }
  hello(): void {
    this.sendRaw(`retry: 3000\n\nevent: hello\ndata: ${JSON.stringify({ stationId: 1, stationName: "Test", serverTime: new Date().toISOString(), protocol: 1, maxAttempts: 3, stuckAfterMs: 30000 })}\n\n`);
  }
  job(job: SentJob): void {
    this.sendRaw(`event: job\ndata: ${JSON.stringify(job)}\n\n`);
  }
  replaced(): void {
    this.sendRaw(`event: replaced\ndata: {"reason":"another agent connected for this station"}\n\n`);
  }
  end(): void {
    this.res.end();
  }
}

export type AckRecord = { jobId: number; status: string; error?: string };

/** An in-test HTTP server speaking the agent protocol (docs/ops/print-agent-protocol.md). */
export class FakeServer extends EventEmitter {
  readonly token = "bhst_" + "T".repeat(43);
  url = "";
  streamRequests: { auth: string | undefined }[] = [];
  streams: ServerStream[] = [];
  acks: AckRecord[] = [];
  ackRequests = 0;
  heartbeats = 0;
  /** One entry consumed per stream request; default is a normal 200 stream. */
  streamPlan: { status: number; headers?: Record<string, string> }[] = [];
  /** Override the ack response for a request (n counts every ack request); undefined = accept. */
  ackBehaviour: (ack: AckRecord, n: number) => { status: number } | "drop" | undefined = () => undefined;
  private server = http.createServer((req, res) => this.handle(req, res));
  private sockets = new Set<import("node:net").Socket>();

  static async start(): Promise<FakeServer> {
    const s = new FakeServer();
    s.server.on("connection", (sock) => {
      s.sockets.add(sock);
      sock.on("close", () => s.sockets.delete(sock));
    });
    await new Promise<void>((r) => s.server.listen(0, "127.0.0.1", r));
    s.url = `http://127.0.0.1:${(s.server.address() as AddressInfo).port}`;
    return s;
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const auth = req.headers.authorization;
    const json = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    };
    const url = req.url ?? "";
    if (url === "/api/agent/stream" && req.method === "GET") {
      this.streamRequests.push({ auth });
      this.emit("change");
      const plan = this.streamPlan.shift();
      if (plan && plan.status !== 200) return json(plan.status, plan.status === 401 ? { error: "unauthorized" } : { error: "x" }, plan.headers);
      if (auth !== `Bearer ${this.token}`) return json(401, { error: "unauthorized" });
      res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform" });
      const stream = new ServerStream(res);
      this.streams.push(stream);
      res.on("close", () => this.emit("change"));
      this.emit("change");
      return;
    }
    if (url === "/api/agent/heartbeat" && req.method === "POST") {
      if (auth !== `Bearer ${this.token}`) return json(401, { error: "unauthorized" });
      this.heartbeats++;
      this.emit("change");
      return json(200, { ok: true, serverTime: new Date().toISOString() });
    }
    const m = /^\/api\/agent\/jobs\/(\d+)\/ack$/.exec(url);
    if (m && req.method === "POST") {
      let raw = "";
      req.on("data", (d) => (raw += d));
      req.on("end", () => {
        this.ackRequests++;
        if (auth !== `Bearer ${this.token}`) return json(401, { error: "unauthorized" });
        let body: { status?: string; error?: string } = {};
        try {
          body = JSON.parse(raw);
        } catch {
          return json(400, { error: "invalid_body" });
        }
        const ack: AckRecord = { jobId: Number(m[1]), status: String(body.status), ...(body.error ? { error: body.error } : {}) };
        const behaviour = this.ackBehaviour(ack, this.ackRequests);
        this.emit("change");
        if (behaviour === "drop") return void req.socket.destroy();
        if (behaviour) return json(behaviour.status, { error: "x" }, behaviour.status === 429 ? { "retry-after": "7" } : {});
        this.acks.push(ack);
        this.emit("change");
        return json(200, { ok: true, status: ack.status });
      });
      return;
    }
    json(404, { error: "not_found" });
  }

  waitForStreams(n: number, timeoutMs?: number): Promise<void> {
    return waitUntil(() => this.streams.length >= n, [this], `${n} stream(s)`, timeoutMs);
  }
  waitForStreamRequests(n: number, timeoutMs?: number): Promise<void> {
    return waitUntil(() => this.streamRequests.length >= n, [this], `${n} stream request(s)`, timeoutMs);
  }
  waitForAcks(n: number, timeoutMs?: number): Promise<void> {
    return waitUntil(() => this.acks.length >= n, [this], `${n} ack(s)`, timeoutMs);
  }
  waitForAckRequests(n: number, timeoutMs?: number): Promise<void> {
    return waitUntil(() => this.ackRequests >= n, [this], `${n} ack request(s)`, timeoutMs);
  }
  /** The most recent stream. */
  get stream(): ServerStream {
    return this.streams[this.streams.length - 1];
  }
  async stop(): Promise<void> {
    for (const s of this.streams) s.res.destroy();
    for (const sock of this.sockets) sock.destroy();
    await new Promise<void>((r) => this.server.close(() => r()));
  }
}
