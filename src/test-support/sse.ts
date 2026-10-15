/**
 * Test-side reader for a Server-Sent Events Response (works with a Route Handler's Response and with
 * a fetch() Response alike). Event-based: callers wait for frames, never sleep for them.
 */

export type SseFrame = { event: string | null; data: unknown; comment: string | null; raw: string };

const dec = new TextDecoder();

function parseFrame(raw: string): SseFrame {
  let event: string | null = null;
  let comment: string | null = null;
  const data: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith(":")) comment = line.slice(1).trim();
    else if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  let parsed: unknown = null;
  if (data.length) {
    try {
      parsed = JSON.parse(data.join("\n"));
    } catch {
      parsed = data.join("\n");
    }
  }
  return { event, data: parsed, comment, raw };
}

const timeout = (ms: number, what: string) =>
  new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timeout (${ms} ms) waiting for ${what}`)), ms).unref?.());

export class SseReader {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private buf = "";
  private queue: SseFrame[] = [];
  private pending: Promise<void> | null = null;
  ended = false;
  /** Every frame handed out so far (in order). */
  readonly seen: SseFrame[] = [];

  constructor(res: Response) {
    if (!res.body) throw new Error("response has no body");
    this.reader = res.body.getReader();
  }

  private pump(): Promise<void> {
    this.pending ??= (async () => {
      try {
        const { done, value } = await this.reader.read();
        if (done) {
          this.ended = true;
          return;
        }
        this.buf += dec.decode(value, { stream: true }).replace(/\r\n/g, "\n");
        let i: number;
        while ((i = this.buf.indexOf("\n\n")) >= 0) {
          const raw = this.buf.slice(0, i);
          this.buf = this.buf.slice(i + 2);
          this.queue.push(parseFrame(raw));
        }
      } catch {
        this.ended = true;
      } finally {
        this.pending = null;
      }
    })();
    return this.pending;
  }

  /** Next frame, or null once the stream ended. Rejects on timeout. */
  async next(timeoutMs = 3000): Promise<SseFrame | null> {
    for (;;) {
      const f = this.queue.shift();
      if (f) {
        this.seen.push(f);
        return f;
      }
      if (this.ended) return null;
      await Promise.race([this.pump(), timeout(timeoutMs, "the next SSE frame")]);
    }
  }

  /** Skips frames until one matches; rejects when the stream ends first or on timeout. */
  async until(pred: (f: SseFrame) => boolean, timeoutMs = 3000, what = "a matching frame"): Promise<SseFrame> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const f = await this.next(Math.max(1, deadline - Date.now()));
      if (!f) throw new Error(`stream ended while waiting for ${what}`);
      if (pred(f)) return f;
    }
  }

  event(name: string, timeoutMs = 3000): Promise<SseFrame> {
    return this.until((f) => f.event === name, timeoutMs, `event "${name}"`);
  }

  /** Waits for `count` frames of `name` and returns their data. */
  async events(name: string, count: number, timeoutMs = 3000): Promise<unknown[]> {
    const out: unknown[] = [];
    while (out.length < count) out.push((await this.event(name, timeoutMs)).data);
    return out;
  }

  /** True when the stream ends (cleanly) within the time; false on timeout. */
  async waitEnd(timeoutMs = 3000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      let f: SseFrame | null;
      try {
        f = await this.next(Math.max(1, deadline - Date.now()));
      } catch {
        return false;
      }
      if (!f) return true;
    }
  }

  /** Negative assertion: true when no frame of `name` arrives during `ms` (stream end counts as none). */
  async noEventWithin(name: string, ms: number): Promise<boolean> {
    const deadline = Date.now() + ms;
    for (;;) {
      const left = deadline - Date.now();
      if (left <= 0) return true;
      try {
        const f = await this.next(left);
        if (!f) return true;
        if (f.event === name) return false;
      } catch {
        return true;
      }
    }
  }

  async cancel(): Promise<void> {
    await this.reader.cancel().catch(() => {});
  }
}
