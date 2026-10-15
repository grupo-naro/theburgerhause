import { AckDelivery, AgentApi } from "./ack";
import { StreamClient } from "./client";
import { realClock, type Clock, type Rng } from "./clock";
import type { AgentConfig } from "./config";
import { consoleSink, createLogger, fileSink, type Logger } from "./logger";
import { createBackend, type PrinterBackend } from "./printer";
import { StateStore } from "./state";
import { JobWorker } from "./worker";

export type { AgentConfig } from "./config";
export { loadConfig, describeConfig, maskToken } from "./config";
export type { PrinterBackend } from "./printer";
export type { Logger } from "./logger";

export type AgentDeps = {
  backend?: PrinterBackend;
  clock?: Clock;
  rng?: Rng;
  logger?: Logger;
  fetch?: typeof fetch;
};

export type AgentHandle = {
  /** Graceful: stops listening, finishes the in-flight job, flushes the persisted state and acks. Idempotent. */
  stop(): Promise<void>;
  status(): { connected: boolean; pendingAcks: number };
};

/**
 * Library entry point: starts the agent in-process (the CLI, the tests and the e2e all use it).
 * Everything with side effects can be injected.
 */
export function startAgent(config: AgentConfig, deps: AgentDeps = {}): AgentHandle {
  const clock = deps.clock ?? realClock;
  const rng = deps.rng ?? Math.random;
  const logger = deps.logger ?? createLogger({ level: config.logLevel, sinks: [consoleSink(), fileSink(config.dataDir)] });
  const backend = deps.backend ?? createBackend(config);
  const state = StateStore.load(config.dataDir);

  const api = new AgentApi({ serverUrl: config.serverUrl, token: config.stationToken, fetch: deps.fetch });
  const acks = new AckDelivery({ api, state, clock, rng, logger });
  const worker = new JobWorker({ backend, state, acks, clock, logger, codepage: config.codepage, paperWidth: config.paperWidth });
  const client = new StreamClient({
    serverUrl: config.serverUrl,
    token: config.stationToken,
    clock,
    rng,
    logger,
    fetch: deps.fetch,
    onJob: (job) => worker.enqueue(job),
    onHello: () => void acks.flush(), // a fresh connection is a good moment to deliver what is pending
  });

  logger.info("Agente iniciado", { impresora: backend.describe(), papel: `${config.paperWidth} mm`, codepage: config.codepage, servidor: config.serverUrl });
  if (state.lastError) logger.warn("No se puede escribir el estado en disco", { err: state.lastError });
  const pending = state.pendingAcks().length;
  if (pending > 0) logger.info("Confirmaciones pendientes de una ejecución anterior", { cantidad: pending });
  acks.start();
  client.start();

  let stopping: Promise<void> | null = null;
  return {
    stop() {
      stopping ??= (async () => {
        const drained = worker.drain(); // closes the queue at once: nothing new starts while we stop
        await client.stop();
        await drained;
        await acks.flush();
        await acks.stop();
        logger.info("Agente detenido");
      })();
      return stopping;
    },
    status: () => ({ connected: client.connected, pendingAcks: state.pendingAcks().length }),
  };
}
