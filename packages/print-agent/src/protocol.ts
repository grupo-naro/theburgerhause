import { StringDecoder } from "node:string_decoder";
import { z } from "zod";

/** Agent side of the wire protocol (docs/ops/print-agent-protocol.md): SSE framing and event parsing. */

export const MAX_FRAME_BYTES = 1024 * 1024;

export type SseFrame = { event: string; data: string };

/**
 * Incremental Server-Sent Events parser. Feed it raw chunks as they arrive; it returns the frames that
 * completed. Tolerant of any chunk boundary (inside field names, values, CRLF pairs, UTF-8 characters),
 * CRLF/LF/CR, multi-line `data:`, comments and `retry:`. A frame or a line bigger than MAX_FRAME_BYTES
 * is dropped (counted in `overflowed`) and parsing resumes after it, so memory stays bounded.
 */
export class SseParser {
  retryMs: number | null = null;
  overflowed = 0;

  private readonly decoder = new StringDecoder("utf8");
  private buf = "";
  private started = false;
  private event = "";
  private data: string[] = [];
  private frameSize = 0;
  private dropping = false;

  get bufferedBytes(): number {
    return this.buf.length + this.frameSize;
  }

  push(chunk: Buffer | Uint8Array): SseFrame[] {
    let text = this.decoder.write(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
    if (!this.started && text.length > 0) {
      this.started = true;
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    }
    this.buf += text;
    const frames: SseFrame[] = [];
    let pos = 0;
    for (;;) {
      let i = pos;
      while (i < this.buf.length && this.buf[i] !== "\n" && this.buf[i] !== "\r") i++;
      if (i >= this.buf.length) break; // incomplete line
      if (this.buf[i] === "\r" && i + 1 >= this.buf.length) break; // maybe the first half of a CRLF
      const line = this.buf.slice(pos, i);
      pos = this.buf[i] === "\r" && this.buf[i + 1] === "\n" ? i + 2 : i + 1;
      const frame = this.line(line);
      if (frame) frames.push(frame);
    }
    this.buf = this.buf.slice(pos);
    if (this.buf.length > MAX_FRAME_BYTES) {
      this.buf = ""; // the rest of this line is garbage up to its newline
      this.drop();
    }
    return frames;
  }

  private drop(): void {
    if (!this.dropping) this.overflowed++;
    this.dropping = true;
    this.event = "";
    this.data = [];
    this.frameSize = 0;
  }

  private line(line: string): SseFrame | null {
    if (line === "") {
      const frame = !this.dropping && this.data.length > 0 ? { event: this.event || "message", data: this.data.join("\n") } : null;
      this.event = "";
      this.data = [];
      this.frameSize = 0;
      this.dropping = false;
      return frame;
    }
    if (this.dropping || line.startsWith(":")) return null;
    this.frameSize += line.length + 1;
    if (this.frameSize > MAX_FRAME_BYTES) {
      this.drop();
      return null;
    }
    const colon = line.indexOf(":");
    const name = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (name === "event") this.event = value;
    else if (name === "data") this.data.push(value);
    else if (name === "retry" && /^\d{1,9}$/.test(value)) this.retryMs = Number(value);
    return null;
  }
}

const helloSchema = z.object({
  stationId: z.number(),
  stationName: z.string(),
  serverTime: z.string().optional(),
  protocol: z.number().optional(),
  maxAttempts: z.number().optional(),
  stuckAfterMs: z.number().optional(),
});
export type Hello = z.infer<typeof helloSchema>;

const jobSchema = z.object({
  id: z.number().int().positive(),
  type: z.string().catch("unknown"),
  attempts: z.number().catch(1),
  createdAt: z.string().catch(""),
  document: z.unknown(),
});
/** `document` is validated later (by the worker) so a bad one can still be acked as failed. */
export type AgentJob = z.infer<typeof jobSchema>;

export type AgentEvent =
  | { kind: "hello"; hello: Hello }
  | { kind: "job"; job: AgentJob }
  | { kind: "replaced" }
  | { kind: "ignored"; reason: string };

function json(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return undefined;
  }
}

export function parseAgentEvent(frame: SseFrame): AgentEvent {
  if (frame.event === "replaced") return { kind: "replaced" };
  if (frame.event === "hello") {
    const r = helloSchema.safeParse(json(frame.data));
    return r.success ? { kind: "hello", hello: r.data } : { kind: "ignored", reason: "hello inválido" };
  }
  if (frame.event === "job") {
    const r = jobSchema.safeParse(json(frame.data));
    return r.success ? { kind: "job", job: r.data } : { kind: "ignored", reason: "job inválido" };
  }
  return { kind: "ignored", reason: `evento desconocido` };
}
