import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startAgent, type AgentHandle } from "./index";
import type { AgentConfig } from "./config";
import { toEscPos } from "./escpos";
import { createLogger } from "./logger";
import { PrintError } from "./printer/types";
import { CaptureLog, FakeBackend, FakeClock, FakeServer, sampleDocument, sampleJob, tmpDir, waitUntil } from "./testing/support";

let server: FakeServer;
let dir: string;
let clock: FakeClock;
let log: CaptureLog;
let backend: FakeBackend;
const agents: AgentHandle[] = [];

beforeEach(async () => {
  server = await FakeServer.start();
  dir = tmpDir();
  clock = new FakeClock();
  log = new CaptureLog();
  backend = new FakeBackend();
});
afterEach(async () => {
  await Promise.all(agents.splice(0).map((a) => a.stop()));
  await server.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

const config = (over: Partial<AgentConfig> = {}): AgentConfig => ({
  serverUrl: server.url,
  stationToken: server.token,
  paperWidth: 80,
  codepage: "cp858",
  printerBackend: "console",
  printerPort: 9100,
  outputDir: path.join(dir, "output"),
  dataDir: dir,
  logLevel: "debug",
  allowInsecure: false,
  ...over,
});
function boot(over: Partial<AgentConfig> = {}): AgentHandle {
  const a = startAgent(config(over), { backend, clock, rng: () => 0, logger: createLogger({ level: "debug", sinks: [log.sink] }) });
  agents.push(a);
  return a;
}
async function connected() {
  await server.waitForStreams(1);
  server.stream.hello();
  await log.waitFor("conectado");
}
const stateFile = () => JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8"));

describe("startAgent: the happy path", () => {
  it("hello -> job -> printed once with the ESC/POS bytes -> ack done POSTed", async () => {
    boot();
    await connected();
    server.stream.job(sampleJob(21));
    await server.waitForAcks(1);
    expect(backend.prints).toHaveLength(1);
    expect(backend.prints[0].bytes).toEqual(toEscPos(sampleDocument("PEDIDO 21") as never, { paperWidth: 80, codepage: "cp858" }));
    expect(server.acks).toEqual([{ jobId: 21, status: "done" }]);
    expect(stateFile().printed.map((p: { id: number }) => p.id)).toEqual([21]);
  });

  it("the same job twice: ONE print and a done ack for each delivery", async () => {
    boot();
    await connected();
    server.stream.job(sampleJob(5));
    await server.waitForAcks(1);
    server.stream.job(sampleJob(5, { attempts: 2 }));
    await server.waitForAcks(2);
    expect(backend.prints).toHaveLength(1);
    expect(server.acks).toEqual([{ jobId: 5, status: "done" }, { jobId: 5, status: "done" }]);
  });

  it("three jobs arriving together are printed and acked in order", async () => {
    boot();
    await connected();
    server.stream.job(sampleJob(1));
    server.stream.job(sampleJob(2));
    server.stream.job(sampleJob(3));
    await server.waitForAcks(3);
    expect(backend.prints.map((p) => p.jobId)).toEqual([1, 2, 3]);
    expect(server.acks.map((a) => a.jobId)).toEqual([1, 2, 3]);
  });

  it("a print failure acks failed with the short Spanish message", async () => {
    backend.plan = [new PrintError("La impresora no responde")];
    boot();
    await connected();
    server.stream.job(sampleJob(8));
    await server.waitForAcks(1);
    expect(server.acks).toEqual([{ jobId: 8, status: "failed", error: "La impresora no responde" }]);
  });

  it("an invalid document acks failed 'documento inválido' and prints nothing", async () => {
    boot();
    await connected();
    server.stream.job(sampleJob(9, { document: { blocks: [{ type: "text" }] } }));
    await server.waitForAcks(1);
    expect(server.acks).toEqual([{ jobId: 9, status: "failed", error: "documento inválido" }]);
    expect(backend.prints).toHaveLength(0);
  });
});

describe("startAgent: persistence and restarts", () => {
  it("an ack that cannot be delivered is persisted and retried until it is", async () => {
    server.ackBehaviour = (_a, n) => (n <= 2 ? "drop" : undefined);
    boot();
    await connected();
    server.stream.job(sampleJob(30));
    await clock.waitForTimer("ack-retry");
    expect(stateFile().pendingAcks.map((a: { jobId: number }) => a.jobId)).toEqual([30]);
    await clock.fire("ack-retry");
    await clock.waitForTimer("ack-retry");
    await clock.fire("ack-retry");
    await server.waitForAcks(1);
    expect(backend.prints).toHaveLength(1);
    await waitUntil(() => stateFile().pendingAcks.length === 0, [server], "queue drained");
  });

  it("restart with an undelivered ack in the queue: it is delivered by the new agent, without printing again", async () => {
    server.ackBehaviour = () => "drop";
    const first = boot();
    await connected();
    server.stream.job(sampleJob(31));
    await clock.waitForTimer("ack-retry");
    await first.stop();
    expect(stateFile().pendingAcks).toHaveLength(1);

    server.ackBehaviour = () => undefined;
    server.streams.length = 0;
    boot();
    await server.waitForAcks(1);
    expect(server.acks).toEqual([{ jobId: 31, status: "done" }]);
    await server.waitForStreams(1);
    server.stream.hello();
    server.stream.job(sampleJob(31, { attempts: 2 })); // the server also redelivers it
    await log.waitFor("Trabajo repetido"); // acked done already (the queue keeps one done per job)
    expect(backend.prints).toHaveLength(1);
    expect(server.acks.every((a) => a.jobId === 31 && a.status === "done")).toBe(true);
  });

  it("crash after printing but before the ack: the redelivered job is NOT printed again and is acked done", async () => {
    // what a crash right after the print leaves on disk: the id is persisted, no ack was queued
    fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify({ version: 1, printed: [{ id: 40, at: "2026-10-15T10:00:00.000Z" }], pendingAcks: [] }));
    boot();
    await connected();
    server.stream.job(sampleJob(40, { attempts: 2 }));
    await server.waitForAcks(1);
    expect(backend.prints).toHaveLength(0);
    expect(server.acks).toEqual([{ jobId: 40, status: "done" }]);
  });

  it("a corrupt state file is tolerated: the agent starts clean and keeps the bad file aside", async () => {
    fs.writeFileSync(path.join(dir, "state.json"), "{{{ not json");
    boot();
    await connected();
    server.stream.job(sampleJob(50));
    await server.waitForAcks(1);
    expect(backend.prints).toHaveLength(1);
    expect(fs.readdirSync(dir).some((f) => f.startsWith("state.corrupt-"))).toBe(true);
  });

  it("an offline agent gets the pending jobs on reconnect, once", async () => {
    boot();
    await connected();
    server.stream.end();
    await clock.waitForTimer("reconnect");
    await clock.fire("reconnect");
    await server.waitForStreams(2);
    server.stream.hello();
    server.stream.job(sampleJob(60));
    server.stream.job(sampleJob(61));
    await server.waitForAcks(2);
    expect(backend.prints.map((p) => p.jobId)).toEqual([60, 61]);
  });
});

describe("startAgent: a broken state directory", () => {
  it("logs ONE error per window, keeps printing and acking from memory", async () => {
    boot();
    await connected();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.writeFileSync(dir, "the data dir became a file: no save can work");
    server.stream.job(sampleJob(90));
    server.stream.job(sampleJob(91));
    server.stream.job(sampleJob(92));
    await server.waitForAcks(3);
    expect(backend.prints.map((p) => p.jobId)).toEqual([90, 91, 92]);
    expect(log.count("No se pudo guardar el estado")).toBe(1);
    expect(log.entries.find((e) => e.msg.includes("No se pudo guardar el estado"))?.level).toBe("error");
    fs.rmSync(dir, { force: true });
    fs.mkdirSync(dir);
  });
});

describe("startAgent: graceful stop", () => {
  it("stop() finishes the in-flight job and delivers its ack before resolving", async () => {
    backend.plan = ["hang"];
    const agent = boot();
    await connected();
    server.stream.job(sampleJob(70));
    server.stream.job(sampleJob(71));
    await waitUntil(() => backend.prints.length === 1, [backend], "print started");
    const stopping = agent.stop();
    backend.release();
    await stopping;
    expect(server.acks).toEqual([{ jobId: 70, status: "done" }]); // 71 never started: the server re-delivers it
    expect(backend.prints.map((p) => p.jobId)).toEqual([70]);
    expect(stateFile().pendingAcks).toEqual([]);
  });

  it("stop() is idempotent and leaves no timers behind", async () => {
    const agent = boot();
    await connected();
    await agent.stop();
    await agent.stop();
    expect(clock.pending()).toEqual([]);
  });
});

describe("startAgent: errors from the server", () => {
  it("a wrong token logs the clear message, keeps backing off and never crashes", async () => {
    boot({ stationToken: "bhst_" + "W".repeat(43) });
    await server.waitForStreamRequests(1);
    await log.waitFor("Token inválido o rotado: generá uno nuevo en Admin → Estaciones");
    await clock.waitForTimer("reconnect");
    expect(clock.pending("reconnect")[0].ms).toBe(5000);
    await clock.fire("reconnect");
    await server.waitForStreamRequests(2);
    await clock.waitForTimer("reconnect");
    expect(clock.pending("reconnect")[0].ms).toBe(10_000);
  });

  it("replaced: waits 60 s before trying again", async () => {
    boot();
    await connected();
    server.stream.replaced();
    await clock.waitForTimer("reconnect");
    expect(clock.pending("reconnect")[0].ms).toBe(60_000);
  });
});

describe("startAgent: secrets", () => {
  it("neither the token nor the document contents ever reach the log", async () => {
    boot();
    await connected();
    server.stream.job(sampleJob(80, { document: sampleDocument("NOMBRE DEL CLIENTE SECRETO") }));
    await server.waitForAcks(1);
    server.stream.end();
    await clock.waitForTimer("reconnect");
    const all = log.lines.join("\n");
    expect(all).not.toContain(server.token);
    expect(all).not.toContain("SECRETO");
    expect(all).not.toContain("T".repeat(20));
  });
});
