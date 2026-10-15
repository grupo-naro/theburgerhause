import { getDb } from "@/db/client";
import { clientIp } from "@/lib/client-ip";
import { getTrackingStatus, isTrackingToken } from "@/lib/orders/tracking";
import { checkTrackingRequest, peekTrackingMisses, recordTrackingMiss } from "@/lib/orders/tracking-rate-limit";

/**
 * Customer polling endpoint. Public capability URL: no auth, no cookies, never cached, and it
 * says as little as possible (three fields, or one uniform 404 / 429 body).
 */

const HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
} as const;

const json = (body: unknown, status: number, extra: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { ...HEADERS, ...extra } });

const notFound = () => json({ error: "not found" }, 404);
const tooMany = (retryAfterMs: number) =>
  json({ error: "too many requests" }, 429, { "Retry-After": String(Math.max(1, Math.ceil(retryAfterMs / 1000))) });

export async function GET(request: Request, ctx: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await ctx.params;
  const ip = clientIp(request.headers);

  const requests = checkTrackingRequest(ip);
  if (!requests.ok) return tooMany(requests.retryAfterMs);
  const misses = peekTrackingMisses(ip);
  if (!misses.ok) return tooMany(misses.retryAfterMs);

  // Wrong shape: answered like an unknown token, without a lookup (and without spending a miss).
  if (!isTrackingToken(token)) return notFound();

  const found = await getTrackingStatus(getDb(), token);
  if (!found) {
    recordTrackingMiss(ip);
    return notFound();
  }
  // Field by field: whatever the read model grows, the wire format stays these three.
  return json({ status: found.status, paymentStatus: found.paymentStatus, updatedAt: found.updatedAt }, 200);
}
