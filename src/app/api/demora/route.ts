import { getDb } from "@/db/client";
import { clientIp } from "@/lib/client-ip";
import { getPublicDelay, type PublicDelay } from "@/lib/delay/public";
import { checkDemoraRequest } from "@/lib/delay/rate-limit";

/** Public read-only estimate for the menu and "Tu pedido". Never carries the manual delay's reason. */

const HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
} as const;

export async function GET(request: Request): Promise<Response> {
  const limit = checkDemoraRequest(clientIp(request.headers));
  if (!limit.ok) {
    return Response.json(
      { error: "too many requests" },
      { status: 429, headers: { ...HEADERS, "Retry-After": String(Math.max(1, Math.ceil(limit.retryAfterMs / 1000))) } },
    );
  }
  let d: PublicDelay;
  try {
    d = await getPublicDelay(getDb());
  } catch {
    return new Response(null, { status: 503, headers: HEADERS });
  }
  // Field by field: whatever the read model grows, the wire format stays these three.
  const body: PublicDelay = {
    takeaway: { low: d.takeaway.low, high: d.takeaway.high },
    delivery: { low: d.delivery.low, high: d.delivery.high },
    delayed: d.delayed,
  };
  return Response.json(body, { status: 200, headers: HEADERS });
}
