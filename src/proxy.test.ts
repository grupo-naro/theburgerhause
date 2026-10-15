import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { describe, expect, it } from "vitest";
import { config, proxy } from "@/proxy";

const BASE = "http://localhost:3000";
const req = (path: string, cookie?: string) =>
  new NextRequest(`${BASE}${path}`, cookie ? { headers: { cookie } } : undefined);

const PROTECTED = ["/caja", "/mostrador", "/despacho", "/despacho/5", "/admin", "/admin/menu", "/estacion"];
const PUBLIC = ["/", "/checkout", "/carrito", "/pedido/123", "/login", "/uploads/a.webp", "/api/health", "/brand/logo-512.webp"];

describe("proxy", () => {
  it.each(PROTECTED)("redirects %s to /login with next when there is no session cookie", (path) => {
    const res = proxy(req(path));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`${BASE}/login?next=${encodeURIComponent(path)}`);
  });

  it("keeps the query string in next, encoded", () => {
    const res = proxy(req("/admin/menu?tab=a&x=1%202"));
    expect(res.headers.get("location")).toBe(`${BASE}/login?next=${encodeURIComponent("/admin/menu?tab=a&x=1%202")}`);
  });

  it.each(PROTECTED)("passes %s through with a session cookie", (path) => {
    const res = proxy(req(path, "bh_session=abc"));
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("treats an empty cookie value as no session", () => {
    expect(proxy(req("/caja", "bh_session=")).status).toBe(307);
  });

  it("ignores unrelated cookies", () => {
    expect(proxy(req("/caja", "bh_station=1")).status).toBe(307);
  });
});

describe("proxy matcher", () => {
  it.each(PROTECTED)("runs on %s", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true);
  });
  it.each(PUBLIC)("does not run on %s", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(false);
  });
});
