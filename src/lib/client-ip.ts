/**
 * Client IP from X-Forwarded-For: the LAST hop, i.e. the one our own trusted
 * reverse proxy appended. Earlier hops are attacker-controlled.
 * DEPLOY: the Nginx config must set `proxy_set_header X-Forwarded-For $remote_addr;`
 * (overwrite, not append) so the header holds exactly one trusted value.
 */
export function clientIp(headers: Pick<Headers, "get">): string {
  const raw = headers.get("x-forwarded-for");
  const last = raw?.split(",").pop()?.trim();
  return last || "unknown";
}
