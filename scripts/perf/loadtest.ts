import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import {
  build,
  ensurePerfDir,
  flag,
  loadEnv,
  machineSpecs,
  option,
  prepareDatabase,
  ROOT,
  serverEnv,
  startServer,
  stamp,
  treeRssMb,
} from "./common.mjs";

/**
 * `pnpm loadtest` - the realistic Friday-night peak against the PRODUCTION build (`next start`) and the e2e-style seeded
 * TEST database:
 *
 *   30 customers browsing the menu (HTML + assets + /carrito)      20 customers polling their order status every 8 s
 *   10 orders / minute created by calling the REAL createOrderAction over HTTP (the way the browser does)
 *   the cashier and the delivery manager approving them (REAL approveOrderAction over HTTP, session cookies)
 *   9 staff screens on /api/events (SSE)                           9 print agents on /api/agent/stream, acking every job
 *
 * All staff screens and all agents share ONE client IP (same X-Forwarded-For) like the restaurant does; the run counts any
 * 429 they get (must be zero). Customers use their own addresses.
 *
 *   --no-build           reuse the existing build and seeded test DB
 *   --duration SECONDS   steady-state length (default 180)
 *   --customers N        browsing customers (default 30)
 *   --orders-per-min N   (default 10)
 *   --label NAME         file suffix (default: timestamp)
 *
 * Raw results: perf-reports/loadtest-<label>.json. A local run is indicative, not a production guarantee.
 */

const env = loadEnv();
const DURATION_S = Number(option("duration") ?? 180);
const CUSTOMERS = Number(option("customers") ?? 30);
const ORDERS_PER_MIN = Number(option("orders-per-min") ?? 10);
const TRACKERS = 20;
const RAMP_S = 20;
const VENUE_IP = "203.0.113.50"; // staff PCs + agents
const label = option("label") ?? stamp();

// ---------------------------------------------------------------------------------------------- metrics

const samples = new Map<string, number[]>();
const statuses = new Map<string, Map<string, number>>();
const venueStatuses = new Map<string, number>();

function record(key: string, ms: number, status: number | string, venue = false): void {
  (samples.get(key) ?? samples.set(key, []).get(key)!).push(ms);
  const m = statuses.get(key) ?? statuses.set(key, new Map()).get(key)!;
  m.set(String(status), (m.get(String(status)) ?? 0) + 1);
  if (venue) venueStatuses.set(String(status), (venueStatuses.get(String(status)) ?? 0) + 1);
}

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

function summarize(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  return { n: s.length, p50: Math.round(pct(s, 50)), p95: Math.round(pct(s, 95)), p99: Math.round(pct(s, 99)), max: Math.round(s[s.length - 1] ?? NaN) };
}

// ------------------------------------------------------------------------------------------------ http

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const stop = new AbortController();
let running = true;

type ReqOpts = { ip: string; cookie?: string; token?: string; venue?: boolean };

async function timedFetch(key: string, url: string, init: RequestInit, o: ReqOpts): Promise<{ status: number; text: string } | null> {
  const t = performance.now();
  try {
    const res = await fetch(url, {
      ...init,
      signal: stop.signal,
      headers: {
        "x-forwarded-for": o.ip,
        ...(o.cookie ? { cookie: o.cookie } : {}),
        ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    const text = await res.text();
    record(key, performance.now() - t, res.status, o.venue);
    return { status: res.status, text };
  } catch (e) {
    if (!running) return null;
    record(key, performance.now() - t, `error:${(e as Error).name}`, o.venue);
    return null;
  }
}

// -------------------------------------------------------------------------------------------- server actions

type ActionIds = Record<string, string>;
function actionIds(): ActionIds {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, ".next/server/server-reference-manifest.json"), "utf8")) as {
    node: Record<string, { exportedName: string }>;
  };
  const ids: ActionIds = {};
  for (const [id, e] of Object.entries(manifest.node)) ids[e.exportedName] = id;
  return ids;
}

/** Calls a Server Action the way the browser does: POST to a page that uses it, Next-Action header, args as a JSON array. */
async function callAction(key: string, id: string, pagePath: string, args: unknown[], o: ReqOpts): Promise<unknown | null> {
  const res = await timedFetch(
    key,
    `${env.baseUrl}${pagePath}`,
    {
      method: "POST",
      headers: {
        "next-action": id,
        "content-type": "text/plain;charset=UTF-8",
        accept: "text/x-component",
        origin: env.baseUrl,
      },
      body: JSON.stringify(args),
    },
    o,
  );
  if (!res || res.status !== 200) return null;
  // Flight response: `0:{...}` metadata line, then `1:<result json>` (the action's return value).
  const line = res.text.split("\n").find((l) => l.startsWith("1:"));
  if (!line) return null;
  try {
    return JSON.parse(line.slice(2));
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------------------------------------ SSE

async function readSse(url: string, key: string, o: ReqOpts, onFrame: (event: string, data: string) => void): Promise<void> {
  const t = performance.now();
  let res: Response;
  try {
    res = await fetch(url, {
      signal: stop.signal,
      headers: { "x-forwarded-for": o.ip, ...(o.cookie ? { cookie: o.cookie } : {}), ...(o.token ? { authorization: `Bearer ${o.token}` } : {}) },
    });
  } catch (e) {
    if (running) record(key, performance.now() - t, `error:${(e as Error).name}`, o.venue);
    return;
  }
  record(key, performance.now() - t, res.status, o.venue);
  if (res.status !== 200 || !res.body) return;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        let event = "message";
        const data: string[] = [];
        for (const line of block.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data.push(line.slice(5).trim());
        }
        if (data.length) onFrame(event, data.join("\n"));
      }
    }
  } catch {
    // aborted at the end of the run (or a real drop: counted below through `drops`)
  }
  if (running) drops.push(key);
}

const drops: string[] = [];

// ------------------------------------------------------------------------------------------------- main

async function main(): Promise<void> {
  if (!flag("no-build")) {
    prepareDatabase(env);
    build(env);
  }
  const server = await startServer(env);
  const out = ensurePerfDir();

  // In-process access to the TEST database (fixtures, sessions, final assertions). Its connections are tagged so the
  // pg_stat_activity sample can tell them from the app's pool.
  Object.assign(process.env, serverEnv(env), { DATABASE_URL: `${env.testUrl}?application_name=loadtest` });
  const { getDb, closeDb } = await import("../../src/db/client");
  const schema = await import("../../src/db/schema");
  const { createOrder } = await import("../../src/lib/orders/create-order");
  const { createSession } = await import("../../src/lib/auth/session-store");
  const { createStation, rotateStationToken } = await import("../../src/lib/stations/admin");
  const { eq, sql, inArray } = await import("drizzle-orm");
  const db = getDb();

  const startedAt = new Date();
  try {
    // ---------- fixtures: products, 9 stations with tokens, staff sessions, 20 orders to poll ----------
    const products = await db.select().from(schema.products);
    const byName = (n: string) => products.find((p) => p.name === n)!;
    const burgers = ["Ranchita simple", "Melt simple", "Holtber extreme simple"].map(byName);
    if (burgers.some((b) => !b)) throw new Error("seed products missing");

    let stationRows = await db.select().from(schema.stations);
    for (let i = stationRows.length; i < 9; i++) {
      const kind = i % 2 === 0 ? "mostrador" : "delivery";
      const r = await createStation(db, { name: `Carga ${kind} ${i}`, kind });
      if (!r.ok) throw new Error("could not create a station");
    }
    stationRows = await db.select().from(schema.stations);
    const agents: { stationId: number; name: string; token: string }[] = [];
    for (const st of stationRows.slice(0, 9)) {
      const r = await rotateStationToken(db, st.id);
      if (!r.ok) throw new Error("could not rotate a token");
      agents.push({ stationId: st.id, name: st.name, token: r.data.token });
    }
    const mostrador = stationRows.find((s) => s.name === "Mostrador 1") ?? stationRows.find((s) => s.kind === "mostrador")!;
    const delivery = stationRows.find((s) => s.name === "Delivery 1") ?? stationRows.find((s) => s.kind === "delivery")!;

    const userRows = await db.select().from(schema.users);
    const user = (name: string) => userRows.find((u) => u.username === name)!;
    const cookie = async (userId: number, stationId: number | null) => `bh_session=${(await createSession(db, { userId, stationId })).token}`;
    const staff = [
      ...(await Promise.all([1, 2, 3].map(() => cookie(user("admin").id, null)))),
      ...(await Promise.all([1, 2, 3].map(() => cookie(user("cajera").id, mostrador.id)))),
      ...(await Promise.all([1, 2, 3].map(() => cookie(user("encargada").id, delivery.id)))),
    ];
    const cajeraCookie = staff[3];
    const encargadaCookie = staff[6];

    const trackTokens: string[] = [];
    for (let i = 0; i < TRACKERS; i++) {
      const r = await createOrder(db, {
        idempotencyKey: crypto.randomUUID(),
        units: [{ productId: burgers[i % 3].id, modifierIds: [], note: "" }],
        customer: { name: `Seguimiento ${i}`, whatsapp: `11 7000-${String(1000 + i)}` },
        fulfillment: "takeaway",
        paymentMethod: "cash",
        bh_ref: "",
      });
      if (!r.ok) throw new Error(`fixture order failed: ${r.code}`);
      trackTokens.push(r.data.publicToken);
    }
    const ids = actionIds();
    for (const n of ["createOrderAction", "approveOrderAction"]) if (!ids[n]) throw new Error(`action id of ${n} not found in the build manifest`);

    // ---------- memory + Postgres samplers ----------
    const rss: { t: number; mb: number | null }[] = [];
    const conns: { t: number; total: number; byApp: Record<string, number> }[] = [];
    const pgc = new Client({ connectionString: env.serverUrl, application_name: "loadtest-sampler" });
    await pgc.connect();
    const t0 = Date.now();
    const sampleOnce = async () => {
      rss.push({ t: Math.round((Date.now() - t0) / 1000), mb: treeRssMb((server.child as { pid?: number }).pid!) });
      const r = await pgc.query<{ app: string; n: string }>(
        `select coalesce(nullif(application_name, ''), '(app pool)') as app, count(*) as n from pg_stat_activity
         where datname = $1 and application_name not in ('loadtest', 'loadtest-sampler') group by 1`,
        ["burgerhause_test"],
      );
      const byApp = Object.fromEntries(r.rows.map((x) => [x.app, Number(x.n)]));
      conns.push({ t: Math.round((Date.now() - t0) / 1000), total: Object.values(byApp).reduce((a, b) => a + b, 0), byApp });
    };
    await sampleOnce();
    const sampler = setInterval(() => void sampleOnce().catch(() => {}), 10_000);

    // ---------- actors ----------
    const created = new Map<number, { t0: number; tResp: number; kind: "delivery" | "takeaway" }>();
    const seen = new Map<string, number>(); // `${stream}:${orderId}` -> ms timestamp of the first `created` event
    const eventLatencies: number[] = [];
    const eventAfterResponse: number[] = [];
    const jobsAcked = { done: 0, failed: 0 };
    const approvals = { ok: 0, failed: 0 };

    // 9 agents
    const agentTasks = agents.map((a, i) =>
      (async () => {
        await sleep(i * 100);
        const hb = setInterval(() => {
          void timedFetch("POST /api/agent/heartbeat", `${env.baseUrl}/api/agent/heartbeat`, { method: "POST" }, { ip: VENUE_IP, token: a.token, venue: true });
        }, 20_000);
        await readSse(`${env.baseUrl}/api/agent/stream`, "SSE connect /api/agent/stream", { ip: VENUE_IP, token: a.token, venue: true }, (event, data) => {
          if (event !== "job") return;
          const job = JSON.parse(data) as { id: number };
          void (async () => {
            await sleep(rand(60, 200)); // the "printing"
            const res = await timedFetch(
              "POST /api/agent/jobs/:id/ack",
              `${env.baseUrl}/api/agent/jobs/${job.id}/ack`,
              { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "done" }) },
              { ip: VENUE_IP, token: a.token, venue: true },
            );
            if (res?.status === 200) jobsAcked.done++;
            else jobsAcked.failed++;
          })();
        });
        clearInterval(hb);
      })(),
    );

    // 9 staff screens
    const staffTasks = staff.map((c, i) =>
      (async () => {
        await sleep(i * 100);
        await readSse(`${env.baseUrl}/api/events`, "SSE connect /api/events", { ip: VENUE_IP, cookie: c, venue: true }, (event, data) => {
          if (event !== "orders") return;
          const e = JSON.parse(data) as { orderId: number; event: string };
          if (e.event !== "created") return;
          const key = `${i}:${e.orderId}`;
          if (seen.has(key)) return;
          const now = performance.now();
          // The event can arrive BEFORE the action response (and before `created` knows the id): latencies are computed at the end.
          seen.set(key, now);
        });
      })(),
    );

    await sleep(1500); // streams up before the load starts

    // customers browsing
    const assetsSeen = new Set<string>();
    const customerTasks = Array.from({ length: CUSTOMERS }, (_, i) =>
      (async () => {
        const ip = `198.51.100.${10 + i}`;
        await sleep((i / CUSTOMERS) * RAMP_S * 1000);
        let first = true;
        while (running) {
          const home = await timedFetch("GET /", `${env.baseUrl}/`, {}, { ip });
          if (home?.status === 200) {
            const assets = new Set<string>();
            for (const m of home.text.matchAll(/(?:src|href)="(\/(?:_next\/static|uploads)\/[^"]+)"/g)) assets.add(m[1]);
            for (const m of home.text.matchAll(/(\/uploads\/[0-9a-f-]+(?:\.thumb)?\.webp)/g)) assets.add(m[1]);
            const wanted = first ? [...assets] : [...assets].filter((a) => a.startsWith("/uploads/")).slice(0, 3);
            first = false;
            await Promise.all(
              wanted.map((a) => {
                const kind = a.startsWith("/uploads/") ? "GET /uploads/*" : "GET /_next/static/*";
                if (kind === "GET /_next/static/*" && assetsSeen.has(`${ip}${a}`)) return null;
                assetsSeen.add(`${ip}${a}`);
                return timedFetch(kind, `${env.baseUrl}${a}`, {}, { ip });
              }),
            );
          }
          await sleep(rand(1500, 4000));
          await timedFetch("GET /carrito", `${env.baseUrl}/carrito`, {}, { ip });
          await sleep(rand(4000, 9000));
        }
      })(),
    );

    // customers waiting for their order
    const trackerTasks = trackTokens.map((token, i) =>
      (async () => {
        const ip = `192.0.2.${10 + i}`;
        await sleep(rand(0, 8000));
        while (running) {
          await timedFetch("GET /api/pedido/:token/status", `${env.baseUrl}/api/pedido/${token}/status`, {}, { ip });
          await sleep(8000 + rand(-500, 500));
        }
      })(),
    );

    // orders: created and approved over HTTP, at ORDERS_PER_MIN
    let orderSeq = 0;
    const orderTasks: Promise<void>[] = [];
    const placeOne = async () => {
      const n = ++orderSeq;
      const kind: "delivery" | "takeaway" = n % 2 === 0 ? "delivery" : "takeaway";
      const unitsCount = 1 + (n % 3);
      const ip = `203.0.113.${100 + (n % 150)}`;
      const input = {
        idempotencyKey: crypto.randomUUID(),
        units: Array.from({ length: unitsCount }, (_, k) => ({ productId: burgers[(n + k) % 3].id, modifierIds: [], note: "" })),
        customer: { name: `Cliente carga ${n}`, whatsapp: `11 ${String(2000 + (n % 7000)).padStart(4, "0")}-${String(1000 + n).slice(-4)}` },
        fulfillment: kind,
        ...(kind === "delivery" ? { delivery: { address: `Calle ${n} 1234`, crossStreets: "Entre A y B", notes: "" } } : {}),
        paymentMethod: "cash",
        bh_ref: "",
      };
      const t0 = performance.now();
      const result = (await callAction("POST createOrderAction", ids.createOrderAction, "/checkout", [input], { ip })) as
        | { ok?: boolean; id?: number; orderId?: number; number?: number; publicToken?: string }
        | null;
      const tResp = performance.now();
      const orderId = result?.ok ? await orderIdByToken(result.publicToken) : null;
      if (!result?.ok || !orderId) return;
      created.set(orderId, { t0, tResp, kind });
      await sleep(rand(1500, 4000)); // someone reads the ticket and clicks Aprobar
      const r = (await callAction(
        "POST approveOrderAction",
        ids.approveOrderAction,
        kind === "delivery" ? "/delivery" : "/retiro",
        [{ orderId, paymentVerified: false }],
        { ip: VENUE_IP, cookie: kind === "delivery" ? encargadaCookie : cajeraCookie, venue: true },
      )) as { ok?: boolean } | null;
      if (r?.ok) approvals.ok++;
      else approvals.failed++;
    };
    async function orderIdByToken(token: string | undefined): Promise<number | null> {
      if (!token) return null;
      const [row] = await db.select({ id: schema.orders.id }).from(schema.orders).where(eq(schema.orders.publicToken, token));
      return row?.id ?? null;
    }
    const orderLoop = (async () => {
      await sleep(5000);
      const gap = 60_000 / ORDERS_PER_MIN;
      const until = Date.now() + (DURATION_S - 10) * 1000;
      while (running && Date.now() < until) {
        orderTasks.push(placeOne());
        await sleep(gap * rand(0.8, 1.2));
      }
    })();

    // ---------- run ----------
    console.log(`Load test: ${CUSTOMERS} customers, ${TRACKERS} trackers, ${ORDERS_PER_MIN} orders/min, 9 staff SSE, 9 agents, ${DURATION_S} s (${machineSpecs()})`);
    const progress = setInterval(() => console.log(`  t=${Math.round((Date.now() - t0) / 1000)}s orders=${created.size} approvals=${approvals.ok} jobs done=${jobsAcked.done} rss=${rss.at(-1)?.mb ?? "?"}MB pg=${conns.at(-1)?.total ?? "?"}`), 30_000);
    await sleep(DURATION_S * 1000);
    await orderLoop;
    await Promise.allSettled(orderTasks);
    await sleep(6000); // drain: last approvals -> jobs -> acks
    await sampleOnce();

    // ---------- verification in the DB (before the streams are cut) ----------
    const orderIds = [...created.keys()];
    const dbOrders = orderIds.length ? await db.select({ id: schema.orders.id, status: schema.orders.status }).from(schema.orders).where(inArray(schema.orders.id, orderIds)) : [];
    const jobRows = orderIds.length
      ? await db.select({ status: schema.printJobs.status, n: sql<number>`count(*)::int` }).from(schema.printJobs).where(inArray(schema.printJobs.orderId, orderIds)).groupBy(schema.printJobs.status)
      : [];
    running = false;
    clearInterval(sampler);
    clearInterval(progress);
    stop.abort();
    await Promise.allSettled([...agentTasks, ...staffTasks, ...customerTasks, ...trackerTasks]);
    await pgc.end();

    // ---------- report ----------
    const rssValues = rss.map((r) => r.mb).filter((x): x is number => x !== null);
    const half = Math.floor(rssValues.length / 2);
    const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : NaN);
    const slope = (() => {
      const pts = rss.filter((r) => r.mb !== null && r.t > 40) as { t: number; mb: number }[];
      if (pts.length < 3) return NaN;
      const mt = avg(pts.map((p) => p.t)), mm = avg(pts.map((p) => p.mb));
      const num = pts.reduce((a, p) => a + (p.t - mt) * (p.mb - mm), 0);
      const den = pts.reduce((a, p) => a + (p.t - mt) ** 2, 0);
      return (num / den) * 60;
    })();
    const endpointRows = [...samples.entries()].map(([key, v]) => ({ endpoint: key, ...summarize(v), statuses: Object.fromEntries(statuses.get(key) ?? []) }));
    const serverErrors = endpointRows.reduce((a, r) => a + Object.entries(r.statuses).filter(([s]) => /^5|^error/.test(s)).reduce((x, [, n]) => x + (n as number), 0), 0);
    const venue429 = venueStatuses.get("429") ?? 0;
    const pgTotals = conns.map((c) => c.total);
    const expectedSeen = orderIds.length * staff.length;
    const missedEvents = expectedSeen - [...seen.keys()].filter((k) => created.has(Number(k.split(":")[1]))).length;
    for (const [key, at] of seen) {
      const c0 = created.get(Number(key.split(":")[1]));
      if (!c0) continue;
      eventLatencies.push(at - c0.t0);
      eventAfterResponse.push(at - c0.tResp); // negative: the event beat the action's own response
    }
    const sseStats = summarize(eventLatencies);
    const homeStats = endpointRows.find((r) => r.endpoint === "GET /");
    const dbStatusCounts = dbOrders.reduce<Record<string, number>>((a, o) => ((a[o.status] = (a[o.status] ?? 0) + 1), a), {});

    const result = {
      label,
      startedAt: startedAt.toISOString(),
      machine: machineSpecs(),
      config: { DURATION_S, CUSTOMERS, TRACKERS, ORDERS_PER_MIN, staffStreams: staff.length, agents: agents.length, sharedVenueIp: VENUE_IP },
      endpoints: endpointRows,
      sseDeliveryMs: { ...sseStats, afterActionResponse: summarize(eventAfterResponse), missedEvents, expectedEvents: expectedSeen },
      orders: { created: orderIds.length, approved: approvals.ok, approvalFailures: approvals.failed, dbStatuses: dbStatusCounts, printJobsByStatus: Object.fromEntries(jobRows.map((r) => [r.status, r.n])), agentAcks: jobsAcked },
      venueIp429: venue429,
      venueIpStatuses: Object.fromEntries(venueStatuses),
      streamDrops: drops,
      memoryMb: { start: rssValues[0], end: rssValues.at(-1), max: Math.max(...rssValues), firstHalfAvg: avg(rssValues.slice(0, half)), secondHalfAvg: avg(rssValues.slice(half)), slopeMbPerMin: Number(slope.toFixed(2)), series: rss },
      postgresConnections: { max: Math.max(...pgTotals), last: pgTotals.at(-1), series: conns },
      serverLogTail: server.output().split("\n").slice(-15),
    };
    writeFileSync(path.join(out, `loadtest-${label}.json`), JSON.stringify(result, null, 2));

    console.log(`\n${"endpoint".padEnd(34)} ${"n".padStart(6)} ${"p50".padStart(6)} ${"p95".padStart(6)} ${"p99".padStart(6)} ${"max".padStart(6)}  statuses`);
    for (const r of endpointRows.sort((a, b) => a.endpoint.localeCompare(b.endpoint))) {
      console.log(`${r.endpoint.padEnd(34)} ${String(r.n).padStart(6)} ${String(r.p50).padStart(6)} ${String(r.p95).padStart(6)} ${String(r.p99).padStart(6)} ${String(r.max).padStart(6)}  ${JSON.stringify(r.statuses)}`);
    }
    console.log(`\nSSE delivery (request start -> seen by a staff screen): p50 ${sseStats.p50} ms, p95 ${sseStats.p95} ms, p99 ${sseStats.p99} ms; after the action response: p95 ${summarize(eventAfterResponse).p95} ms; missed ${missedEvents}/${expectedSeen}`);
    console.log(`Orders: created ${orderIds.length}, approved ${approvals.ok} (failed ${approvals.failed}), print jobs ${JSON.stringify(Object.fromEntries(jobRows.map((r) => [r.status, r.n])))}, agent acks ${JSON.stringify(jobsAcked)}`);
    console.log(`Shared venue IP (9 staff + 9 agents + approvals): ${venue429} x 429; statuses ${JSON.stringify(Object.fromEntries(venueStatuses))}`);
    console.log(`Memory (RSS of the Next process tree): start ${rssValues[0]} MB, end ${rssValues.at(-1)} MB, max ${Math.max(...rssValues)} MB, trend ${slope.toFixed(1)} MB/min after warmup`);
    console.log(`Postgres connections to the app DB: max ${Math.max(...pgTotals)}, last ${pgTotals.at(-1)} ${JSON.stringify(conns.at(-1)?.byApp)}`);
    console.log(`5xx / network errors: ${serverErrors}; stream drops: ${drops.length}`);
    const ok =
      serverErrors === 0 &&
      venue429 === 0 &&
      missedEvents === 0 &&
      sseStats.p95 < 1000 &&
      (homeStats?.p95 ?? Infinity) < 800 &&
      Math.max(...pgTotals) <= 12 &&
      drops.length === 0;
    console.log(`\nCriteria (0 5xx, 0 shared-IP 429, p95 menu < 800 ms, SSE p95 < 1 s, no missed events, pg <= 12, no stream drops): ${ok ? "ALL MET" : "NOT MET"}`);
    console.log(`Raw results: ${path.join(out, `loadtest-${label}.json`)}`);
    if (!ok) process.exitCode = 1;
    await closeDb();
  } finally {
    running = false;
    stop.abort();
    await server.stop();
  }
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
