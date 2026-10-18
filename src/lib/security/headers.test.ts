import { describe, expect, it } from "vitest";
import { baseSecurityHeaders, contentSecurityPolicy, CSP_ENFORCE, CSP_HEADER_NAME, PERMISSIONS_POLICY, REFERRER_DEFAULT_SOURCE } from "./headers";

const map = (isDev = false) => Object.fromEntries(baseSecurityHeaders({ isDev }).map((h) => [h.key, h.value]));

describe("security headers", () => {
  it("sets the fixed hardening headers on every response", () => {
    const h = map();
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(h["X-DNS-Prefetch-Control"]).toBe("off");
  });

  it("denies every powerful feature the product does not use", () => {
    for (const f of ["camera", "microphone", "geolocation", "payment", "usb", "serial"]) {
      expect(PERMISSIONS_POLICY).toContain(`${f}=()`);
    }
  });

  it("sends the CSP under exactly one header name, chosen by the single CSP_ENFORCE switch", () => {
    const h = map();
    const [enforcing, reportOnly] = ["Content-Security-Policy", "Content-Security-Policy-Report-Only"];
    expect(CSP_HEADER_NAME).toBe(CSP_ENFORCE ? enforcing : reportOnly);
    expect(h[CSP_HEADER_NAME]).toBeTruthy();
    expect(h[CSP_ENFORCE ? reportOnly : enforcing]).toBeUndefined();
  });

  it("CSP locks everything to the own origin and forbids framing, plugins and base/form hijacking", () => {
    const csp = contentSecurityPolicy();
    for (const d of [
      "default-src 'self'",
      "connect-src 'self'",
      "font-src 'self'",
      "img-src 'self' data: blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "report-uri /api/csp-report",
    ]) {
      expect(csp.split("; ")).toContain(d);
    }
    // No remote origin anywhere, and no eval in production.
    expect(csp).not.toMatch(/https?:/);
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toContain("ws:");
  });

  it("only development relaxes the policy (eval for React tooling, ws for HMR)", () => {
    const dev = contentSecurityPolicy({ isDev: true });
    expect(dev).toContain("'unsafe-eval'");
    expect(dev).toContain("ws:");
  });

  it("the default Referrer-Policy rule excludes the capability URLs", () => {
    const re = new RegExp(`^${REFERRER_DEFAULT_SOURCE}$`);
    expect(re.test("/")).toBe(true);
    expect(re.test("/carrito")).toBe(true);
    expect(re.test("/api/health")).toBe(true);
    expect(re.test("/pedido/abc")).toBe(false);
    expect(re.test("/api/pedido/abc/status")).toBe(false);
  });
});
