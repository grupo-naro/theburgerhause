import { createHash } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import * as s from "../src/db/schema";
import { db } from "./helpers/db";
import { openSheet, gotoStore, sheetOf } from "./helpers/store";
import { placeOrderInDb } from "./helpers/tracking";
import { authFile, USERS } from "./helpers/users";

/**
 * Task 9.3 security checks against the REAL production build (`next start`, NODE_ENV=production):
 * response headers, CSP (report-only) violations on every public and staff page, cookie flags, session
 * fixation, revoked/expired sessions on a page, a Server Action and the SSE stream, the login limiter,
 * and the Server Action same-origin (CSRF) check.
 */

const anonymous = { cookies: [], origins: [] };
const sha = (token: string) => createHash("sha256").update(token).digest("hex");

test.describe("security headers", () => {
  test.use({ storageState: anonymous });

  const COMMON = async (res: { headers(): Record<string, string> }) => {
    const h = res.headers();
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["cross-origin-opener-policy"]).toBe("same-origin");
    expect(h["x-dns-prefetch-control"]).toBe("off");
    expect(h["permissions-policy"]).toContain("camera=()");
    expect(h["permissions-policy"]).toContain("geolocation=()");
    expect(h["x-powered-by"]).toBeUndefined();
    const csp = h["content-security-policy-report-only"];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("report-uri /api/csp-report");
    expect(csp).not.toContain("unsafe-eval");
    // Report-only until the owner switches it (docs/ops/runbook.md).
    expect(h["content-security-policy"]).toBeUndefined();
    return h;
  };

  for (const path of ["/", "/carrito", "/checkout", "/login", "/api/health", "/uploads/00000000-0000-0000-0000-000000000000.webp"]) {
    test(`${path} carries the hardening headers and the default Referrer-Policy`, async ({ request }) => {
      const h = await COMMON(await request.get(path));
      expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    });
  }

  test("the order page and its status API keep no-referrer, no-store and noindex", async ({ request }) => {
    const order = await placeOrderInDb();
    const page = await COMMON(await request.get(`/pedido/${order.token}`));
    expect(page["referrer-policy"]).toBe("no-referrer");
    expect(page["cache-control"]).toContain("no-store");
    expect(page["x-robots-tag"]).toContain("noindex");
    const api = await request.get(`/api/pedido/${order.token}/status`);
    expect(api.headers()["referrer-policy"]).toBe("no-referrer");
    expect(api.headers()["cache-control"]).toBe("no-store");
  });

  test("redirects and 404s are covered too", async ({ request }) => {
    const redirect = await request.get("/caja", { maxRedirects: 0 });
    expect(redirect.status()).toBe(307);
    expect(redirect.headers()["x-frame-options"]).toBe("DENY");
    const missing = await request.get("/no-such-page");
    expect(missing.status()).toBe(404);
    expect(missing.headers()["x-content-type-options"]).toBe("nosniff");
  });

  test("the CSP report endpoint answers 204 and rejects non-POST", async ({ request }) => {
    const ok = await request.post("/api/csp-report", {
      headers: { "content-type": "application/csp-report" },
      data: { "csp-report": { "effective-directive": "img-src", "blocked-uri": "https://example.test/x.png" } },
    });
    expect(ok.status()).toBe(204);
    expect((await request.get("/api/csp-report")).status()).toBe(405);
  });
});

/** Collects CSP violations (event and console message) from before any page script runs. */
async function watchCsp(page: Page): Promise<() => Promise<string[]>> {
  const consoleHits: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) consoleHits.push(m.text());
  });
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => w.__csp.push(`${e.effectiveDirective} ${e.blockedURI}`));
  });
  return async () => {
    const events = await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);
    return [...events, ...consoleHits];
  };
}

async function visit(page: Page, path: string, violations: () => Promise<string[]>): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState("load");
  await expect(page.locator("main, h1").first()).toBeVisible();
  // Two frames: styles, images and lazy chunks have been requested.
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  expect(await violations(), `CSP violations on ${path}`).toEqual([]);
}

test.describe("CSP: no violation of the report-only policy on any page", () => {
  test.describe("public", () => {
    test.use({ storageState: anonymous });

    test("menu, product sheet, cart, checkout, login and the order page", async ({ page }) => {
      const violations = await watchCsp(page);
      await visit(page, "/", violations);
      await gotoStore(page);
      const sheet = await openSheet(page, "Ranchita simple");
      await expect(sheet).toBeVisible();
      expect(await violations(), "CSP violations with the product sheet open").toEqual([]);
      await sheet.getByTestId("sheet-cta").click();
      await expect(sheetOf(page)).toHaveCount(0);
      await visit(page, "/carrito", violations);
      await visit(page, "/checkout", violations);
      await visit(page, "/login", violations);
      const order = await placeOrderInDb();
      await visit(page, `/pedido/${order.token}`, violations);
    });
  });

  const staff: Array<{ who: keyof typeof USERS; paths: string[] }> = [
    { who: "admin", paths: ["/admin/menu", "/admin/modificadores", "/admin/cadetes", "/admin/usuarios", "/admin/estaciones", "/admin/ajustes", "/caja", "/despacho"] },
    { who: "cajera", paths: ["/mostrador", "/mostrador/pedidos", "/retiro", "/estacion"] },
    { who: "encargada", paths: ["/delivery", "/delivery/rendicion"] },
  ];
  for (const { who, paths } of staff) {
    test.describe(who, () => {
      test.use({ storageState: authFile(who) });
      test(`staff pages of ${who}`, async ({ page }) => {
        const violations = await watchCsp(page);
        for (const path of paths) await visit(page, path, violations);
      });
    });
  }
});

async function sessionCookie(page: Page): Promise<{ value: string; httpOnly: boolean; secure: boolean; sameSite: string; path: string; expires: number }> {
  const cookies = await page.context().cookies();
  const c = cookies.find((x) => x.name === "bh_session");
  expect(c, "bh_session cookie").toBeDefined();
  return c!;
}

const randomIp = () => `10.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;

/**
 * Logs the cashier in through the real form in a fresh context. Each call uses its OWN client IP
 * (X-Forwarded-For): the login limiter is per IP and the whole e2e run shares one, so these extra
 * logins must not eat the budget of the other specs.
 */
async function freshCashier(browser: Browser, baseURL: string | undefined) {
  const context = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": randomIp() }, storageState: anonymous });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Usuario").fill(USERS.cajera.username);
  await page.getByLabel("Contraseña").fill(USERS.cajera.password);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).toHaveURL(/\/estacion/);
  await page.getByRole("button", { name: /Mostrador 1/ }).click();
  await expect(page).toHaveURL(/\/mostrador$/);
  return { context, page };
}

test.describe("cookies and sessions (production build)", () => {
  test.use({ storageState: anonymous });

  test("session and station cookies are HttpOnly, Secure, SameSite=Lax, Path=/ and hold no personal data", async ({ browser, baseURL }) => {
    const { context, page } = await freshCashier(browser, baseURL);
    try {
      const cookies = await context.cookies();
      expect(cookies.map((c) => c.name).sort()).toEqual(["bh_session", "bh_station"]);
      for (const c of cookies) {
        expect(c.httpOnly, c.name).toBe(true);
        expect(c.secure, c.name).toBe(true); // NODE_ENV=production under `next start`; Nginx terminates TLS in the VPS
        expect(c.sameSite, c.name).toBe("Lax");
        expect(c.path, c.name).toBe("/");
      }
      const session = cookies.find((c) => c.name === "bh_session")!;
      const station = cookies.find((c) => c.name === "bh_station")!;
      expect(session.value).toMatch(/^[A-Za-z0-9_-]{43}$/); // 256 random bits, nothing readable inside
      expect(station.value).toMatch(/^\d{1,9}$/); // a station id is not a credential
      const days = (session.expires - Date.now() / 1000) / 86400;
      expect(days).toBeGreaterThan(29);
      expect(days).toBeLessThan(31);
      // Not readable by page scripts.
      expect(await page.evaluate(() => document.cookie)).toBe("");
      // The DB only knows the sha256 of the token.
      const [row] = await db().select().from(s.sessions).where(eq(s.sessions.id, sha(session.value)));
      expect(row).toBeDefined();
      expect(row.id).not.toBe(session.value);
    } finally {
      await context.close();
    }
  });

  test("every login issues a NEW token, and a token planted before login is never adopted (no session fixation)", async ({ browser, baseURL }) => {
    const a = await freshCashier(browser, baseURL);
    const b = await freshCashier(browser, baseURL);
    const tokenA = (await sessionCookie(a.page)).value;
    const tokenB = (await sessionCookie(b.page)).value;
    expect(tokenA).not.toBe(tokenB);
    await a.context.close();
    await b.context.close();

    const headers = { "x-forwarded-for": randomIp() };
    const context = await browser.newContext({ baseURL, extraHTTPHeaders: headers, storageState: anonymous });
    const planted = "attacker-chosen-session-value-0123456789abcdef";
    await context.addCookies([{ name: "bh_session", value: planted, url: baseURL! }]);
    const page = await context.newPage();
    await page.goto("/login");
    await page.getByLabel("Usuario").fill(USERS.cajera.username);
    await page.getByLabel("Contraseña").fill(USERS.cajera.password);
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page).toHaveURL(/\/(estacion|mostrador)/);
    expect((await sessionCookie(page)).value).not.toBe(planted);
    expect(await db().select().from(s.sessions).where(eq(s.sessions.id, sha(planted)))).toHaveLength(0);
    await context.close();

    // And the planted value alone gets nowhere.
    const attacker = await browser.newContext({ baseURL, extraHTTPHeaders: headers, storageState: anonymous });
    await attacker.addCookies([{ name: "bh_session", value: planted, url: baseURL! }]);
    const p = await attacker.newPage();
    await p.goto("/mostrador");
    await expect(p).toHaveURL(/\/login/);
    await attacker.close();
  });

  test("the 6th login attempt for the same ip+user is blocked, even with the right password", async ({ browser, baseURL }) => {
    const ip = randomIp();
    const context = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": ip }, storageState: anonymous });
    const page = await context.newPage();
    await page.goto("/login");
    // Each attempt waits for its own server answer (the previous error text would still be on screen).
    const attempt = async (password: string) => {
      await page.getByLabel("Usuario").fill(USERS.cajera.username);
      await page.getByLabel("Contraseña").fill(password);
      await Promise.all([
        page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/login"),
        page.getByRole("button", { name: "Ingresar" }).click(),
      ]);
    };
    for (let i = 1; i <= 5; i++) {
      await attempt(`wrong-password-${i}`);
      await expect(page.getByText("Usuario o contraseña incorrectos")).toBeVisible();
    }
    await attempt(USERS.cajera.password);
    await expect(page.getByText(/Demasiados intentos/)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    expect((await context.cookies()).filter((c) => c.name === "bh_session")).toHaveLength(0);
    await context.close();
  });

  for (const how of ["revoked", "expired"] as const) {
    test(`${how === "revoked" ? "a revoked" : "an expired"} session is rejected on a page, on a Server Action and on the SSE stream`, async ({ browser, baseURL }) => {
      const { context, page } = await freshCashier(browser, baseURL);
      try {
        const cookie = (await sessionCookie(page)).value;
        const headers = { cookie: `bh_session=${cookie}`, "x-forwarded-for": "198.51.100.77" };

        // Alive: the stream opens (first bytes arrive), then we stop reading.
        const ctrl = new AbortController();
        const alive = await fetch(`${baseURL}/api/events`, { headers, signal: ctrl.signal });
        expect(alive.status).toBe(200);
        expect(alive.headers.get("content-type")).toContain("text/event-stream");
        ctrl.abort();

        // A form with a Server Action is loaded BEFORE the session dies (like a tab left open overnight).
        await page.goto("/estacion");
        const pick = page.getByRole("button", { name: /Mostrador 1/ });
        await expect(pick).toBeVisible();

        if (how === "revoked") {
          await db().delete(s.sessions).where(eq(s.sessions.id, sha(cookie)));
        } else {
          await db().update(s.sessions).set({ expiresAt: new Date(Date.now() - 3_600_000) }).where(eq(s.sessions.id, sha(cookie)));
        }

        // Server Action: sent to /login, nothing changes.
        await pick.click();
        await expect(page).toHaveURL(/\/login/);

        // SSE: a new connection is refused.
        const dead = await fetch(`${baseURL}/api/events`, { headers });
        expect(dead.status).toBe(401);
        await dead.body?.cancel();

        // Page navigation with the stale cookie.
        await page.goto("/mostrador");
        await expect(page).toHaveURL(/\/login/);
      } finally {
        await context.close();
      }
    });
  }

  test("a Server Action posted with a foreign Origin is refused (login cannot be CSRFed)", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": randomIp() }, storageState: anonymous });
    const page = await context.newPage();
    let forged = 0;
    await page.route("**/login", async (route) => {
      const req = route.request();
      if (req.method() === "POST" && req.headers()["next-action"]) {
        forged++;
        await route.continue({ headers: { ...req.headers(), origin: "https://evil.example" } });
      } else {
        await route.continue();
      }
    });
    await page.goto("/login");
    await page.getByLabel("Usuario").fill(USERS.cajera.username);
    await page.getByLabel("Contraseña").fill(USERS.cajera.password);
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect.poll(() => forged).toBeGreaterThan(0);
    await expect(page).toHaveURL(/\/login/);
    expect((await context.cookies()).filter((c) => c.name === "bh_session")).toHaveLength(0);
    await context.close();
  });
});
