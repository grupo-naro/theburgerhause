import type { NextConfig } from "next";
import { baseSecurityHeaders, REFERRER_DEFAULT, REFERRER_DEFAULT_SOURCE } from "./src/lib/security/headers";

const isDev = process.env.NODE_ENV === "development";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // No "X-Powered-By: Next.js" fingerprint.
  poweredByHeader: false,
  experimental: {
    // Server Action request bodies are capped explicitly (the Next default is 1 MB too, but a default is
    // not a decision). Images never travel through actions: they use /api/uploads (5 MB, own cap).
    // `allowedOrigins` stays empty on purpose: Nginx forwards the public Host/X-Forwarded-Host, so the
    // same-origin check (Origin vs host) passes without extra entries.
    serverActions: { bodySizeLimit: "1mb" },
  },
  // Security headers (src/lib/security/headers.ts). Rules are cumulative; the one that sets Referrer-Policy
  // for the capability URLs (/pedido) is separate so the two never collide.
  async headers() {
    return [
      { source: "/:path*", headers: baseSecurityHeaders({ isDev }) },
      { source: REFERRER_DEFAULT_SOURCE, headers: [REFERRER_DEFAULT] },
      // The order page is a capability URL (its token is the only credential): never cached, never
      // leaked through Referer, never indexed. The status route sets the same headers itself.
      {
        source: "/pedido/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
  // Task 10.1: the rendición moved into the Delivery workspace (the query, e.g. ?cadet=, is kept).
  async redirects() {
    return [{ source: "/despacho/rendicion", destination: "/delivery/rendicion", permanent: false }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
