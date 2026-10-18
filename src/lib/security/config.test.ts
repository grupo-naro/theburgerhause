import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";
import { CSP_HEADER_NAME, REFERRER_DEFAULT_SOURCE } from "./headers";

type Rule = { source: string; headers: { key: string; value: string }[] };

describe("next.config.ts", () => {
  it("caps Server Action bodies explicitly and hides the framework fingerprint", () => {
    expect(nextConfig.experimental?.serverActions?.bodySizeLimit).toBe("1mb");
    expect(nextConfig.poweredByHeader).toBe(false);
    // Nginx forwards the public Host; an allow-list of extra origins would only widen the CSRF check.
    expect(nextConfig.experimental?.serverActions?.allowedOrigins).toBeUndefined();
  });

  it("keeps the public menu prerenderable (cacheComponents on, no per-request nonce machinery)", () => {
    expect(nextConfig.cacheComponents).toBe(true);
  });

  it("applies the security headers to every path and the capability headers to /pedido", async () => {
    const rules = (await nextConfig.headers!()) as Rule[];
    const all = rules.find((r) => r.source === "/:path*")!;
    expect(all.headers.map((h) => h.key)).toEqual(
      expect.arrayContaining(["X-Content-Type-Options", "X-Frame-Options", "Permissions-Policy", CSP_HEADER_NAME]),
    );
    const pedido = rules.find((r) => r.source === "/pedido/:path*")!;
    expect(pedido.headers).toEqual(expect.arrayContaining([{ key: "Referrer-Policy", value: "no-referrer" }, { key: "Cache-Control", value: "private, no-store" }]));
    // No rule other than /pedido may set a conflicting Referrer-Policy on it.
    const referrer = rules.filter((r) => r.headers.some((h) => h.key === "Referrer-Policy"));
    expect(referrer.map((r) => r.source).sort()).toEqual([REFERRER_DEFAULT_SOURCE, "/pedido/:path*"].sort());
  });
});
