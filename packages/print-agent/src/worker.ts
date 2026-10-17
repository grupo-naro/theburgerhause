import type { AckSink } from "./ack";
import type { Clock } from "./clock";
import type { Codepage } from "./codepages";
import { printDocumentSchema, type PrintDocument } from "./document";
import { toEscPos, type PaperWidth } from "./escpos";
import type { Logger } from "./logger";
import { PrintError, type PrinterBackend } from "./printer/types";
import type { AgentJob } from "./protocol";
import type { StateStore } from "./state";

export const PRINT_TIMEOUT_MS = 20_000;
const TIMEOUT_MESSAGE = "La impresora no respondió a tiempo";

export type WorkerOptions = {
  backend: PrinterBackend;
  state: StateStore;
  acks: AckSink;
  clock: Clock;
  logger: Logger;
  codepage: Codepage;
  paperWidth: PaperWidth;
  printTimeoutMs?: number;
};

/**
 * The print pipeline: one job at a time, in arrival order. Idempotent by job.id: an id that was
 * already printed (this run or a previous one, thanks to the persisted state) is never printed
 * again, only acked done. The printed id is persisted BEFORE the ack goes out.
 */
export class JobWorker {
  private queue: AgentJob[] = [];
  private running: Promise<void> | null = null;
  private closed = false;

  constructor(private readonly o: WorkerOptions) {}

  enqueue(job: AgentJob): void {
    if (this.closed) return;
    this.queue.push(job);
    this.running ??= this.pump().finally(() => {
      this.running = null;
    });
  }

  /** Stops taking jobs, drops the ones not started (the server re-delivers them), finishes the in-flight one. */
  async drain(): Promise<void> {
    this.closed = true;
    this.queue = [];
    await this.running;
  }

  private async pump(): Promise<void> {
    for (let job = this.queue.shift(); job; job = this.queue.shift()) {
      try {
        await this.handle(job);
      } catch (err) {
        this.o.logger.error("Error inesperado procesando un trabajo", { job: job.id, err });
      }
    }
  }

  private async handle(job: AgentJob): Promise<void> {
    const { state, acks, logger } = this.o;
    if (state.hasPrinted(job.id)) {
      logger.info("Trabajo repetido: ya estaba impreso, solo se confirma", { job: job.id });
      acks.submit({ jobId: job.id, status: "done" });
      return;
    }
    const parsed = printDocumentSchema.safeParse(job.document);
    if (!parsed.success) {
      logger.warn("Documento inválido", { job: job.id });
      acks.submit({ jobId: job.id, status: "failed", error: "documento inválido" });
      return;
    }
    const bytes = toEscPos(parsed.data as PrintDocument, { paperWidth: this.o.paperWidth, codepage: this.o.codepage });
    const started = this.o.clock.now();
    const result = await this.printWithTimeout(job.id, bytes);
    if (result.ok) {
      state.markPrinted(job.id);
      logger.info("Trabajo impreso", { job: job.id, tipo: job.type, bytes: bytes.length, ms: this.o.clock.now() - started });
      acks.submit({ jobId: job.id, status: "done" });
      return;
    }
    logger.error("Falló la impresión", { job: job.id, motivo: result.message, ...(result.known ? {} : { err: result.err }) });
    acks.submit({ jobId: job.id, status: "failed", error: result.message });
  }

  private printWithTimeout(jobId: number, bytes: Buffer): Promise<{ ok: true } | { ok: false; message: string; known: boolean; err?: unknown }> {
    const { backend, clock } = this.o;
    return new Promise((resolve) => {
      let settled = false;
      const timer = clock.setTimeout(
        () => {
          if (settled) return;
          settled = true;
          resolve({ ok: false, message: TIMEOUT_MESSAGE, known: true });
        },
        this.o.printTimeoutMs ?? PRINT_TIMEOUT_MS,
        "print-timeout",
      );
      backend.print(bytes, { jobId }).then(
        () => {
          timer.cancel();
          if (settled) {
            // it did print, just too late: remember it so the redelivery is not printed again
            this.o.state.markPrinted(jobId);
            this.o.logger.warn("La impresión terminó después del tiempo límite; se confirma como hecha", { job: jobId });
            this.o.acks.submit({ jobId, status: "done" });
            return;
          }
          settled = true;
          resolve({ ok: true });
        },
        (err: unknown) => {
          timer.cancel();
          if (settled) return;
          settled = true;
          resolve(err instanceof PrintError ? { ok: false, message: err.message, known: true } : { ok: false, message: "Error de impresión", known: false, err });
        },
      );
    });
  }
}
