import type { Db } from "@/db/client";
import { clientIp } from "@/lib/client-ip";
import { authenticateStation, type AgentStation } from "./agent-auth";
import { recordAgentAuthFailure } from "./agent-rate-limit";

/** Request-level helpers shared by the three agent endpoints. No cookies are read or set, no CORS headers. */

const BASE_HEADERS = { "Cache-Control": "no-store" } as const;

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...BASE_HEADERS, ...headers } });
}

/** The ONE 401: identical for absent, malformed, unknown and rotated tokens. */
export const unauthorized = (): Response => jsonResponse(401, { error: "unauthorized" }, { "WWW-Authenticate": "Bearer" });

export type AgentAuth = { ok: true; station: AgentStation } | { ok: false; response: Response };

/**
 * Authenticates the request. Failures spend the per-IP budget (30 / 10 min) and past it answer 429;
 * a VALID token always passes (nine agents share the venue's IP and a misconfigured sibling must not lock the rest out).
 */
export async function authorizeAgent(request: Request, db: Db): Promise<AgentAuth> {
  let station: AgentStation | null;
  try {
    station = await authenticateStation(db, request.headers.get("authorization"));
  } catch (err) {
    const code = (err as { code?: unknown } | null)?.code;
    console.error(`[print] agent auth lookup failed${typeof code === "string" ? ` (${code})` : ""}`);
    return { ok: false, response: jsonResponse(503, { error: "unavailable" }, { "Retry-After": "5" }) };
  }
  if (station) return { ok: true, station };
  const verdict = recordAgentAuthFailure(clientIp(request.headers));
  if (!verdict.ok) {
    return {
      ok: false,
      response: jsonResponse(429, { error: "too_many_attempts" }, { "Retry-After": String(Math.max(1, Math.ceil(verdict.retryAfterMs / 1000))) }),
    };
  }
  return { ok: false, response: unauthorized() };
}
