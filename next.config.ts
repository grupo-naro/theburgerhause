import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // The order page is a capability URL (its token is the only credential): never cached, never
  // leaked through Referer, never indexed. The status route sets the same headers itself.
  async headers() {
    return [
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
