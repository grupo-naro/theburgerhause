/**
 * App-level security headers (Task 9.3). Pure module: next.config.ts imports it by relative path,
 * so it must not use the "@/" alias nor any runtime import.
 *
 * Nginx (deploy/nginx) owns HSTS and adds its own nosniff / X-Frame-Options (the proxy snippet hides
 * the app's copy so each header appears once). The app sets them too so `next start` without Nginx
 * (local, e2e) is equally protected and the headers can be tested.
 */

export type HeaderEntry = { key: string; value: string };

export const CSP_REPORT_PATH = "/api/csp-report";

/**
 * The ONE switch between observing and enforcing the CSP (docs/ops/runbook.md, "Seguridad y rendimiento"). It ships as
 * Report-Only: browsers log violations to /api/csp-report and block nothing. After a week without violations set it to true.
 */
export const CSP_ENFORCE = false;
export const CSP_HEADER_NAME = CSP_ENFORCE ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only";

/**
 * Strictest policy the app satisfies today. 'unsafe-inline' for scripts is a deliberate trade-off:
 * a nonce policy forces dynamic rendering of every page and is incompatible with Partial
 * Prerender (docs: guides/content-security-policy.md), and the public menu `/` is prerendered.
 * 'unsafe-inline' for styles is needed by Tailwind/Next inline <style>. Everything else is locked
 * to the own origin. `isDev` adds 'unsafe-eval' (React dev tooling) and ws: (HMR).
 */
export function contentSecurityPolicy({ isDev = false }: { isDev?: boolean } = {}): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
    "media-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    `report-uri ${CSP_REPORT_PATH}`,
  ];
  return directives.join("; ");
}

/** Features the product never needs are denied outright. */
export const PERMISSIONS_POLICY = [
  "camera=()",
  "microphone=()",
  "geolocation=()",
  "payment=()",
  "usb=()",
  "serial=()",
  "bluetooth=()",
  "midi=()",
  "accelerometer=()",
  "gyroscope=()",
  "magnetometer=()",
  "interest-cohort=()",
].join(", ");

/** Headers for every response. The CSP is Report-Only until CSP_ENFORCE is flipped (docs/ops/runbook.md). */
export function baseSecurityHeaders({ isDev = false }: { isDev?: boolean } = {}): HeaderEntry[] {
  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "X-DNS-Prefetch-Control", value: "off" },
    { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
    { key: CSP_HEADER_NAME, value: contentSecurityPolicy({ isDev }) },
  ];
}

/**
 * Referrer policy for everything except the capability URLs (/pedido, /api/pedido), which keep
 * their own `no-referrer`. A negative-lookahead source keeps the two rules disjoint.
 */
export const REFERRER_DEFAULT_SOURCE = "/((?!pedido|api/pedido).*)";
export const REFERRER_DEFAULT: HeaderEntry = { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" };
