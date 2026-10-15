import { HttpError } from "./errors";

/**
 * CSRF defense in depth for cookie-authenticated Route Handler mutations.
 * Browsers always send Origin on cross-site POSTs, so a missing Origin is rejected too.
 */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const forwarded = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const expectedHost = forwarded || request.headers.get("host");
  let originHost: string | null = null;
  if (origin) {
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
  }
  if (!originHost || !expectedHost || originHost.toLowerCase() !== expectedHost.toLowerCase()) {
    throw new HttpError(403, "Forbidden");
  }
}
