import { clientIp } from "@/lib/client-ip";
import { readCappedText } from "@/lib/http/read-capped";
import { createRateLimiter } from "@/lib/rate-limit";

/**
 * Logic of POST /api/csp-report (the route file only re-exports it). Public by nature (browsers post
 * violation reports without credentials), so it is tiny and bounded: per-IP rate limit, body read
 * capped at MAX_BODY_BYTES, ONE fixed log line per report carrying only the violated directive when it
 * is a known name. The body is never stored, echoed or logged. Always 204 (the browser ignores it).
 */

export const MAX_BODY_BYTES = 8 * 1024;
const KNOWN_DIRECTIVES = new Set([
  "default-src", "script-src", "script-src-elem", "script-src-attr", "style-src", "style-src-elem",
  "style-src-attr", "img-src", "font-src", "connect-src", "media-src", "worker-src", "manifest-src",
  "object-src", "base-uri", "form-action", "frame-ancestors", "frame-src",
]);

export type CspReportOptions = { perMinute?: number; log?: (line: string) => void };

/** Extracts the violated directive name from a report-uri or Reporting API payload; null if unknown. */
export function violatedDirective(body: unknown): string | null {
  const first = Array.isArray(body) ? (body[0] as { body?: unknown } | undefined)?.body : (body as { "csp-report"?: unknown } | null)?.["csp-report"];
  const r = first as { "effective-directive"?: unknown; effectiveDirective?: unknown; "violated-directive"?: unknown } | null | undefined;
  const raw = r?.["effective-directive"] ?? r?.effectiveDirective ?? r?.["violated-directive"];
  if (typeof raw !== "string") return null;
  const name = raw.split(/\s+/)[0];
  return KNOWN_DIRECTIVES.has(name) ? name : null;
}

export function createCspReportHandler(options: CspReportOptions = {}) {
  const limiter = createRateLimiter({ limit: options.perMinute ?? 30, windowMs: 60_000 });
  const log = options.log ?? ((line: string) => console.warn(line));
  const empty = (status: number) => new Response(null, { status, headers: { "Cache-Control": "no-store" } });

  return async function POST(request: Request): Promise<Response> {
    if (!limiter.check(clientIp(request.headers)).ok) return empty(429);
    const declared = Number(request.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return empty(413);
    let directive: string | null = null;
    try {
      const text = await readCappedText(request, MAX_BODY_BYTES);
      if (text !== null) directive = violatedDirective(JSON.parse(text));
    } catch {
      // malformed body: still counts as one report, with an unknown directive
    }
    log(`[csp] violation report${directive ? ` (${directive})` : ""}`);
    return empty(204);
  };
}
