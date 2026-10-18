import { describe, expect, it } from "vitest";
import { readCappedText } from "./read-capped";

const req = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request("http://localhost/x", { method: "POST", body, headers, ...(body instanceof ReadableStream ? { duplex: "half" } : {}) } as RequestInit);

describe("readCappedText", () => {
  it("returns the text when it fits (and the empty string for no body)", async () => {
    expect(await readCappedText(req('{"a":1}'), 100)).toBe('{"a":1}');
    expect(await readCappedText(req(null), 100)).toBe("");
    expect(await readCappedText(req("x".repeat(100)), 100)).toHaveLength(100);
  });

  it("returns null above the limit, counting bytes (not characters)", async () => {
    expect(await readCappedText(req("x".repeat(101)), 100)).toBeNull();
    expect(await readCappedText(req("é".repeat(60)), 100)).toBeNull(); // 120 bytes
  });

  it("refuses a declared oversized Content-Length without touching the body", async () => {
    const pulled = { n: 0 };
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled.n++;
        c.enqueue(new Uint8Array(10));
      },
    });
    expect(await readCappedText(req(body, { "content-length": "999999" }), 100)).toBeNull();
    expect(pulled.n).toBeLessThanOrEqual(1); // the Request constructor primes the stream once; we read nothing
  });

  it("stops reading an endless chunked body right after the limit", async () => {
    let chunks = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        chunks++;
        c.enqueue(new Uint8Array(40));
      },
    });
    expect(await readCappedText(req(body), 100)).toBeNull();
    expect(chunks).toBeLessThan(10);
  });
});
