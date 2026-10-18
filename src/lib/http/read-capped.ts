/**
 * Reads at most `maxBytes` of a request body as UTF-8 text. Returns null as soon as the limit is
 * crossed (the rest of the body is cancelled, never buffered), so a client that streams forever or
 * lies about Content-Length costs at most `maxBytes` of memory. Works for chunked bodies too.
 */
export async function readCappedText(request: Pick<Request, "body" | "headers">, maxBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
