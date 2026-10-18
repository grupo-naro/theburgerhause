import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthSession, Role } from "@/lib/auth/roles";

/**
 * Behavioural half of the authorization audit. For EVERY staff/admin Server Action in SURFACE (loaded
 * through the same registry the surface test uses, so a new classified action is covered automatically)
 * and for every cookie- or token-protected route:
 *  - an anonymous caller is sent to /login (actions) or gets 401 (routes),
 *  - every role outside the entry's allow-list is refused,
 *  - sector-bound actions refuse the wrong station kind and a missing station,
 * and in ALL those cases the database was never touched (`getDb` is a counted trap).
 * Success paths and business rules live in the per-action *.int.test.ts files.
 */

const state = vi.hoisted(() => ({ session: null as unknown, dbCalls: 0 }));

vi.mock("@/lib/auth/session", () => ({
  SESSION_COOKIE: "bh_session",
  getSession: vi.fn(async () => state.session),
  getSessionToken: vi.fn(async () => (state.session ? "token" : null)),
  setSessionCookie: vi.fn(async () => {}),
  clearSessionCookie: vi.fn(async () => {}),
}));

// A db handle for the agent routes: a lookup that finds nothing. Any other use (insert/update/...) throws.
const emptyLookup = { select: () => ({ from: () => ({ where: async () => [] }) }) };
const trap = new Proxy(emptyLookup, {
  get(target, prop) {
    if (prop in target) return (target as Record<string | symbol, unknown>)[prop];
    throw new Error(`DB TOUCHED: ${String(prop)}`);
  },
});
vi.mock("@/db/client", () => ({
  getDb: () => {
    state.dbCalls++;
    return trap;
  },
}));

import { SURFACE } from "./surface";

const modules = import.meta.glob("../../app/**/actions.ts") as Record<string, () => Promise<Record<string, unknown>>>;

function loader(file: string): () => Promise<Record<string, unknown>> {
  const rel = "../../" + file.replace(/^src\//, "");
  const load = modules[rel];
  if (!load) throw new Error(`no module for ${file}`);
  return load;
}

const ALL_ROLES: Role[] = ["admin", "cajera", "encargada_delivery"];

const sessionOf = (role: Role, stationKind: "mostrador" | "delivery" | null = null): AuthSession => ({
  user: { id: 1, name: "T", username: "t", role },
  stationId: stationKind ? 1 : null,
  stationKind,
  sessionId: "s",
});

/** Actions are called with the shapes the browser sends: (prevState, FormData), (FormData) or (payload). */
async function call(fn: (...a: unknown[]) => Promise<unknown>, name: string): Promise<unknown> {
  if (name === "selectStation") return fn(new FormData());
  return fn.length >= 2 ? fn({}, new FormData()) : fn({});
}

type Outcome = { redirectedTo: string | null; value: unknown };
async function run(fn: (...a: unknown[]) => Promise<unknown>, name: string): Promise<Outcome> {
  try {
    return { redirectedTo: null, value: await call(fn, name) };
  } catch (e) {
    const digest = (e as { digest?: unknown }).digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) {
      return { redirectedTo: digest.split(";")[2] ?? "", value: undefined };
    }
    throw e;
  }
}

/** A real authorization refusal, not a validation error that happens to look like a failure. */
const refused = (o: Outcome): boolean => {
  if (o.redirectedTo !== null) return true;
  const v = o.value as { code?: unknown; error?: unknown } | undefined;
  return v?.code === "FORBIDDEN" || (typeof v?.error === "string" && /permisos/.test(v.error));
};

// Importing every actions module (and the route modules) the first time is slow on a busy machine: do it once, outside the per-test timeout.
beforeAll(async () => {
  await Promise.all(Object.values(modules).map((load) => load()));
  await Promise.all([
    import("../../app/api/events/route"),
    import("../../app/api/uploads/route"),
    import("../../app/api/agent/heartbeat/route"),
    import("../../app/api/agent/jobs/[id]/ack/route"),
    import("../../app/api/agent/stream/route"),
  ]);
}, 120_000);

beforeEach(() => {
  state.session = null;
  state.dbCalls = 0;
});
afterEach(() => vi.clearAllMocks());

const protectedActions = Object.entries(SURFACE)
  .filter(([key, e]) => key.startsWith("action:") && (e.access === "staff" || e.access === "admin"))
  .map(([key, e]) => {
    const [file, name] = key.slice("action:".length).split("#");
    return { key, file, name, roles: e.roles ?? [] };
  });

describe("Server Actions: anonymous and wrong-role callers are refused before any DB access", () => {
  it("covers every classified staff/admin action (guards against an empty table)", () => {
    expect(protectedActions.length).toBeGreaterThanOrEqual(35);
  });

  for (const { key, file, name, roles } of protectedActions) {
    describe(key.replace("action:src/app/", ""), () => {
      it("anonymous -> redirect to /login, DB untouched", async () => {
        const fn = (await loader(file)())[name] as (...a: unknown[]) => Promise<unknown>;
        const o = await run(fn, name);
        expect(o.redirectedTo, "must redirect an anonymous caller to /login").toMatch(/^\/login/);
        expect(state.dbCalls).toBe(0);
      });

      for (const role of ALL_ROLES.filter((r) => !roles.includes(r))) {
        it(`role ${role} -> refused, DB untouched`, async () => {
          state.session = sessionOf(role, "mostrador");
          const fn = (await loader(file)())[name] as (...a: unknown[]) => Promise<unknown>;
          const o = await run(fn, name);
          expect(refused(o), JSON.stringify(o)).toBe(true);
          expect(state.dbCalls).toBe(0);
        });
      }
    });
  }
});

describe("sector rule: staff only act in the sector of their station (before any DB access)", () => {
  const sectorBound = protectedActions.filter(
    (a) => /\/(caja|despacho)\/actions\.ts$/.test(a.file) || /delivery\/rendicion\/actions\.ts$/.test(a.file),
  );

  it("covers the caja, despacho and rendicion actions", () => {
    expect(sectorBound.map((a) => a.name).sort()).toEqual(
      [
        "approveOrderAction",
        "assignCadetAction",
        "markDeliveredAction",
        "markPickupAction",
        "markReadyAction",
        "rejectOrderAction",
        "reprintOrderAction",
        "returnToDispatchAction",
        "settleCadetAction",
      ].sort(),
    );
  });

  for (const { file, name, roles } of sectorBound) {
    const staff = roles.filter((r) => r !== "admin");
    for (const role of staff) {
      const wrongKind = role === "cajera" ? "delivery" : "mostrador";
      it(`${name}: ${role} at a ${wrongKind} station -> WRONG_SECTOR`, async () => {
        state.session = sessionOf(role, wrongKind);
        const fn = (await loader(file)())[name] as (...a: unknown[]) => Promise<unknown>;
        const o = await run(fn, name);
        expect((o.value as { code?: string }).code).toBe("WRONG_SECTOR");
        expect(state.dbCalls).toBe(0);
      });
      it(`${name}: ${role} without a station -> STATION_REQUIRED`, async () => {
        state.session = sessionOf(role, null);
        const fn = (await loader(file)())[name] as (...a: unknown[]) => Promise<unknown>;
        const o = await run(fn, name);
        expect((o.value as { code?: string }).code).toBe("STATION_REQUIRED");
        expect(state.dbCalls).toBe(0);
      });
    }
  }
});

describe("Route Handlers", () => {
  const sameOriginPost = (headers: Record<string, string> = {}) =>
    new Request("http://localhost/api/uploads", {
      method: "POST",
      headers: { origin: "http://localhost", host: "localhost", "content-type": "multipart/form-data; boundary=x", ...headers },
      body: "--x--",
    });

  it("GET /api/events: 401 anonymous, DB untouched", async () => {
    const { GET } = await import("../../app/api/events/route");
    const res = await GET(new Request("http://localhost/api/events"));
    expect(res.status).toBe(401);
    expect(state.dbCalls).toBe(0);
  });

  it("POST /api/uploads: 401 anonymous, 403 for cashier and delivery manager, 403 cross-origin; DB untouched", async () => {
    const { POST } = await import("../../app/api/uploads/route");
    expect((await POST(sameOriginPost())).status).toBe(401);
    for (const role of ["cajera", "encargada_delivery"] as Role[]) {
      state.session = sessionOf(role, "mostrador");
      expect((await POST(sameOriginPost())).status).toBe(403);
    }
    state.session = sessionOf("admin");
    expect((await POST(sameOriginPost({ origin: "https://evil.example" }))).status).toBeGreaterThanOrEqual(400);
    expect(state.dbCalls).toBe(0);
  });

  it("agent routes: no, malformed, query-string or unknown tokens are 401 and never reach a write", async () => {
    const heartbeat = (await import("../../app/api/agent/heartbeat/route")).POST;
    const ack = (await import("../../app/api/agent/jobs/[id]/ack/route")).POST;
    const stream = (await import("../../app/api/agent/stream/route")).GET;
    const bad: Array<[string, Record<string, string>, string]> = [
      ["no Authorization", {}, ""],
      ["not a bearer", { authorization: "Basic abc" }, ""],
      ["wrong prefix", { authorization: "Bearer notastation" }, ""],
      ["unknown token", { authorization: "Bearer bhst_" + "a".repeat(43) }, ""],
      ["token in the query string only", {}, "?token=bhst_" + "a".repeat(43)],
    ];
    let n = 0;
    for (const [label, headers, query] of bad) {
      const h = { ...headers, "x-forwarded-for": `198.51.100.${++n}` };
      const calls: Array<[string, Response]> = [
        ["heartbeat", await heartbeat(new Request(`http://localhost/api/agent/heartbeat${query}`, { method: "POST", headers: h }))],
        [
          "ack",
          await ack(new Request(`http://localhost/api/agent/jobs/1/ack${query}`, { method: "POST", headers: h, body: '{"status":"done"}' }), {
            params: Promise.resolve({ id: "1" }),
          }),
        ],
        ["stream", await stream(new Request(`http://localhost/api/agent/stream${query}`, { headers: h }))],
      ];
      for (const [route, res] of calls) expect(res.status, `${route}: ${label}`).toBe(401);
    }
  });
});
