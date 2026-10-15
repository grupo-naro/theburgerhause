import { describe, expect, it } from "vitest";
import { MAX_FRAME_BYTES, parseAgentEvent, SseParser, type SseFrame } from "./protocol";

function feed(chunks: string[], parser = new SseParser()): SseFrame[] {
  return chunks.flatMap((c) => parser.push(Buffer.from(c, "utf8")));
}

describe("SseParser", () => {
  it("parses a complete frame with event and data", () => {
    expect(feed(['event: hello\ndata: {"a":1}\n\n'])).toEqual([{ event: "hello", data: '{"a":1}' }]);
  });

  it("accepts CRLF, LF and bare CR line endings", () => {
    expect(feed(["event: x\r\ndata: 1\r\n\r\n"])).toEqual([{ event: "x", data: "1" }]);
    // a trailing lone CR could still be the first half of a CRLF, so it waits for the next byte
    expect(feed(["event: x\rdata: 1\r\revent: y\rdata: 2\r\r"])).toEqual([{ event: "x", data: "1" }]);
  });

  it("is tolerant of chunk boundaries anywhere, even inside a CRLF pair and field names", () => {
    const raw = 'retry: 3000\r\n\r\nevent: job\r\ndata: {"id":7}\r\n\r\n: ping\n\nevent: replaced\ndata: {}\n\n';
    const expected = feed([raw]);
    expect(expected.map((f) => f.event)).toEqual(["job", "replaced"]);
    for (let size = 1; size <= 9; size++) {
      const chunks: string[] = [];
      for (let i = 0; i < raw.length; i += size) chunks.push(raw.slice(i, i + size));
      expect(feed(chunks)).toEqual(expected);
    }
  });

  it("handles a multi-byte UTF-8 character split between chunks", () => {
    const buf = Buffer.from('event: job\ndata: {"t":"ñ¿"}\n\n', "utf8");
    const p = new SseParser();
    const cut = buf.indexOf(0xc3) + 1; // in the middle of "ñ"
    const out = [...p.push(buf.subarray(0, cut)), ...p.push(buf.subarray(cut))];
    expect(out).toEqual([{ event: "job", data: '{"t":"ñ¿"}' }]);
  });

  it("joins multi-line data with newlines", () => {
    expect(feed(["event: x\ndata: a\ndata: b\n\n"])).toEqual([{ event: "x", data: "a\nb" }]);
  });

  it("strips a single leading space after the colon only", () => {
    expect(feed(["event:x\ndata:  two\n\n"])).toEqual([{ event: "x", data: " two" }]);
  });

  it("ignores comments (pings) and retry lines, with no frame emitted", () => {
    expect(feed([": ping\n\n", "retry: 3000\n\n"])).toEqual([]);
    expect(feed([": ping\nevent: x\ndata: 1\n\n"])).toEqual([{ event: "x", data: "1" }]);
  });

  it("exposes the last retry value", () => {
    const p = new SseParser();
    feed(["retry: 4500\n\n"], p);
    expect(p.retryMs).toBe(4500);
    feed(["retry: nope\n\n"], p);
    expect(p.retryMs).toBe(4500);
  });

  it("defaults the event to 'message' and skips frames with no data", () => {
    expect(feed(["data: 1\n\n"])).toEqual([{ event: "message", data: "1" }]);
    expect(feed(["event: x\n\n"])).toEqual([]);
  });

  it("emits several frames from one chunk, in order", () => {
    const out = feed(["event: a\ndata: 1\n\nevent: b\ndata: 2\n\nevent: c\ndata: 3\n\n"]);
    expect(out.map((f) => f.event)).toEqual(["a", "b", "c"]);
  });

  it("ignores unknown fields and lines without a colon, and a bare id", () => {
    expect(feed(["id: 5\nfoo: bar\nnocolon\nevent: x\ndata: 1\n\n"])).toEqual([{ event: "x", data: "1" }]);
  });

  it("does not emit a frame until the blank line arrives", () => {
    const p = new SseParser();
    expect(feed(["event: x\ndata: 1\n"], p)).toEqual([]);
    expect(feed(["\n"], p)).toEqual([{ event: "x", data: "1" }]);
  });

  it("drops a frame bigger than the guard, keeps parsing afterwards, and never buffers without bound", () => {
    const p = new SseParser();
    const huge = "data: " + "x".repeat(MAX_FRAME_BYTES + 10);
    const out = [...p.push(Buffer.from(huge)), ...p.push(Buffer.from("\n\nevent: ok\ndata: 1\n\n"))];
    expect(out).toEqual([{ event: "ok", data: "1" }]);
    expect(p.overflowed).toBe(1);
    // an endless line without any newline is capped too
    const q = new SseParser();
    for (let i = 0; i < 40; i++) q.push(Buffer.alloc(MAX_FRAME_BYTES / 8, 0x61));
    expect(q.bufferedBytes).toBeLessThanOrEqual(MAX_FRAME_BYTES);
  });

  it("strips a UTF-8 BOM at the very start of the stream", () => {
    expect(feed(["﻿event: x\ndata: 1\n\n"])).toEqual([{ event: "x", data: "1" }]);
  });
});

const job = {
  id: 12,
  type: "kitchen",
  attempts: 1,
  createdAt: "2026-10-15T10:00:00.000Z",
  document: { blocks: [{ type: "text", text: "HOLA" }, { type: "cut" }] },
};

describe("parseAgentEvent", () => {
  it("parses hello", () => {
    const hello = { stationId: 3, stationName: "Mostrador 1", serverTime: "2026-10-15T10:00:00.000Z", protocol: 1, maxAttempts: 3, stuckAfterMs: 30000 };
    expect(parseAgentEvent({ event: "hello", data: JSON.stringify(hello) })).toEqual({ kind: "hello", hello });
  });

  it("parses a job and keeps its document raw (validated later by the worker)", () => {
    const ev = parseAgentEvent({ event: "job", data: JSON.stringify(job) });
    expect(ev).toEqual({ kind: "job", job: { id: 12, type: "kitchen", attempts: 1, createdAt: job.createdAt, document: job.document } });
  });

  it("keeps a job with an invalid document so it can be acked failed", () => {
    const ev = parseAgentEvent({ event: "job", data: JSON.stringify({ ...job, document: { blocks: "nope" } }) });
    expect(ev).toMatchObject({ kind: "job", job: { id: 12, document: { blocks: "nope" } } });
  });

  it("rejects a job without a usable id (nothing to ack)", () => {
    expect(parseAgentEvent({ event: "job", data: JSON.stringify({ ...job, id: "x" }) })).toEqual({ kind: "ignored", reason: "job inválido" });
    expect(parseAgentEvent({ event: "job", data: JSON.stringify({ ...job, id: -1 }) }).kind).toBe("ignored");
  });

  it("parses replaced even with an empty or non-JSON body", () => {
    expect(parseAgentEvent({ event: "replaced", data: "{}" })).toEqual({ kind: "replaced" });
    expect(parseAgentEvent({ event: "replaced", data: "whatever" })).toEqual({ kind: "replaced" });
  });

  it("ignores unknown events and malformed JSON", () => {
    expect(parseAgentEvent({ event: "mystery", data: "{}" }).kind).toBe("ignored");
    expect(parseAgentEvent({ event: "job", data: "{not json" }).kind).toBe("ignored");
    expect(parseAgentEvent({ event: "hello", data: "[]" }).kind).toBe("ignored");
  });
});
