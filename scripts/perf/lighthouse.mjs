import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import lighthouse from "lighthouse";
import { build, ensurePerfDir, flag, loadEnv, machineSpecs, option, prepareDatabase, ROOT, serverEnv, startServer, stamp } from "./common.mjs";

/**
 * `pnpm perf:lighthouse` - mobile Lighthouse audit (default emulation: Moto G Power, simulated slow 4G,
 * 4x CPU slowdown) of the public store and the login page against the PRODUCTION build.
 *
 *   --no-build      reuse the existing .next build and the already seeded test DB
 *   --runs N        runs per page, the median-performance run is reported (default 3)
 *   --label NAME    suffix of the saved files (default: timestamp)
 *   --throttling M  simulate (default, Lighthouse's model) or devtools (really throttled network + CPU: slower, closer to a real phone)
 *   --only NAMES    comma separated page names (home,carrito,checkout,pedido,login)
 *   --strict        exit 1 when a target is missed
 *
 * This file is plain JavaScript on purpose: Lighthouse serialises functions into the browser, and
 * TypeScript runners (tsx/esbuild) inject helpers (`__name`) that do not exist there.
 * Chrome: the Chromium that Playwright installed (`pnpm exec playwright install chromium`); no system Chrome needed.
 * Reports: perf-reports/lighthouse-<label>-<page>.{json,html} and lighthouse-<label>-summary.json (git-ignored).
 */

const TARGETS = { performance: 85, accessibility: 95, cls: 0.05, lcpMs: 2500 };

async function main() {
  const env = loadEnv();
  const runs = Number(option("runs") ?? 3);
  const label = option("label") ?? stamp();
  const dir = ensurePerfDir();

  if (!flag("no-build")) {
    prepareDatabase(env);
    build(env);
  }
  const server = await startServer(env);
  const exe = chromium.executablePath();
  console.log(`Chrome: ${exe}`);

  try {
    const fx = spawnSync(process.execPath, [path.join(ROOT, "node_modules/tsx/dist/cli.mjs"), "scripts/perf/fixtures.ts"], {
      cwd: ROOT,
      env: serverEnv(env),
      encoding: "utf8",
    });
    if (fx.status !== 0) throw new Error(`fixtures failed:\n${fx.stderr}`);
    const { ranchitaId, meltId, token } = JSON.parse(fx.stdout.trim().split("\n").pop());

    const pages = [
      { name: "home", path: "/" },
      { name: "carrito", path: "/carrito", cart: true },
      { name: "checkout", path: "/checkout", cart: true },
      { name: "pedido", path: `/pedido/${token}` },
      { name: "login", path: "/login" },
    ];
    const cart = JSON.stringify({
      v: 1,
      lines: [
        { id: "perf-0", productId: ranchitaId, modifierIds: [], note: "" },
        { id: "perf-1", productId: ranchitaId, modifierIds: [], note: "" },
        { id: "perf-2", productId: meltId, modifierIds: [], note: "" },
      ],
      prices: {},
    });

    const only = option("only")?.split(",");
    const summary = [];
    for (const spec of pages.filter((p) => !only || only.includes(p.name))) {
      const results = [];
      for (let i = 0; i < runs; i++) results.push(await auditOnce(env.baseUrl, spec, exe, cart, option("throttling") ?? "simulate"));
      results.sort((a, b) => a.performance - b.performance);
      const median = results[Math.floor(results.length / 2)];
      writeFileSync(path.join(dir, `lighthouse-${label}-${spec.name}.json`), median.json);
      writeFileSync(path.join(dir, `lighthouse-${label}-${spec.name}.html`), median.html);
      const { json, html, ...rest } = median;
      void json;
      void html;
      summary.push({ page: spec.name, path: spec.path.replace(/pedido\/.*/, "pedido/<token>"), runs, scores: results.map((r) => r.performance), ...rest });
    }
    writeFileSync(path.join(dir, `lighthouse-${label}-summary.json`), JSON.stringify({ machine: machineSpecs(), targets: TARGETS, pages: summary }, null, 2));
    printTable(summary, runs);
    const missed = missedTargets(summary);
    if (missed.length) console.log(`\nTargets missed:\n  - ${missed.join("\n  - ")}`);
    else console.log("\nAll targets met.");
    console.log(`Reports in ${dir}`);
    if (flag("strict") && missed.length) process.exitCode = 1;
  } finally {
    await server.stop();
  }
}

async function auditOnce(baseUrl, spec, exe, cart, throttlingMethod) {
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), "bh-lh-"));
  const port = 9300 + Math.floor(Math.random() * 400);
  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: exe,
    headless: true,
    args: [`--remote-debugging-port=${port}`],
  });
  try {
    if (spec.cart) {
      // Same origin, tiny page: the cart is in localStorage before Lighthouse opens its own (cold-cache) tab.
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(`${baseUrl}/api/health`);
      await page.evaluate((v) => localStorage.setItem("bh_cart_v1", v), cart);
    }
    const result = await lighthouse(
      `${baseUrl}${spec.path}`,
      { port, output: ["json", "html"], logLevel: "error", disableStorageReset: true },
      { extends: "lighthouse:default", settings: { throttlingMethod, onlyCategories: ["performance", "accessibility", "best-practices", "seo"] } },
    );
    if (!result) throw new Error("lighthouse returned nothing");
    const lhr = result.lhr;
    const [json, html] = result.report;
    const num = (id) => lhr.audits[id]?.numericValue ?? NaN;
    const a11yIds = new Set(lhr.categories.accessibility.auditRefs.map((r) => r.id));
    const failedA11y = Object.values(lhr.audits)
      .filter((a) => a11yIds.has(a.id) && a.score !== null && a.score < 1 && !["notApplicable", "informative", "manual"].includes(a.scoreDisplayMode))
      .map((a) => a.id);
    return {
      performance: Math.round((lhr.categories.performance.score ?? 0) * 100),
      accessibility: Math.round((lhr.categories.accessibility.score ?? 0) * 100),
      bestPractices: Math.round((lhr.categories["best-practices"].score ?? 0) * 100),
      seo: Math.round((lhr.categories.seo.score ?? 0) * 100),
      fcpMs: Math.round(num("first-contentful-paint")),
      lcpMs: Math.round(num("largest-contentful-paint")),
      cls: Number(num("cumulative-layout-shift").toFixed(3)),
      tbtMs: Math.round(num("total-blocking-time")),
      speedIndexMs: Math.round(num("speed-index")),
      kb: Math.round(num("total-byte-weight") / 1024),
      failedAccessibilityAudits: failedA11y,
      json,
      html,
    };
  } finally {
    await context.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
}

function printTable(rows, runs) {
  console.log(`\nLighthouse mobile (median of ${runs}), ${machineSpecs()}\n`);
  const head = ["page", "perf", "a11y", "BP", "SEO", "FCP", "LCP", "CLS", "TBT", "SI", "KB"];
  const lines = rows.map((r) => [r.page, r.performance, r.accessibility, r.bestPractices, r.seo, `${r.fcpMs}ms`, `${r.lcpMs}ms`, r.cls, `${r.tbtMs}ms`, `${r.speedIndexMs}ms`, r.kb].map(String));
  const widths = head.map((h, i) => Math.max(h.length, ...lines.map((l) => l[i].length)));
  const fmt = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join("  ");
  console.log(fmt(head));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const l of lines) console.log(fmt(l));
}

function missedTargets(rows) {
  const out = [];
  for (const r of rows) {
    if (r.page === "home" && r.performance < TARGETS.performance) out.push(`home performance ${r.performance} < ${TARGETS.performance}`);
    if (r.page === "home" && r.lcpMs > TARGETS.lcpMs) out.push(`home LCP ${r.lcpMs} ms > ${TARGETS.lcpMs} ms`);
    if (r.accessibility < TARGETS.accessibility) out.push(`${r.page} accessibility ${r.accessibility} < ${TARGETS.accessibility} (${r.failedAccessibilityAudits.join(", ")})`);
    if (r.cls > TARGETS.cls) out.push(`${r.page} CLS ${r.cls} > ${TARGETS.cls}`);
  }
  return out;
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
