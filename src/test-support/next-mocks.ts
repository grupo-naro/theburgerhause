import * as s from "@/db/schema";
import { testDb } from "@/db/test-utils";
import { hashPassword } from "@/lib/auth/password";

/** In-memory stand-ins for next/headers and next/navigation (used by *.int.test.ts). */
export const jar = new Map<string, string>();
export const requestHeaders = { value: new Headers() };

export class RedirectSignal extends Error {
  constructor(readonly url: string) {
    super(`redirect:${url}`);
  }
}

export const nextHeadersMock = {
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    has: (name: string) => jar.has(name),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => requestHeaders.value,
};

export const nextNavigationMock = {
  redirect: (url: string): never => {
    throw new RedirectSignal(url);
  },
};

export function resetNextMocks(): void {
  jar.clear();
  requestHeaders.value = new Headers({ "x-forwarded-for": "10.0.0.1" });
}

/** Resolves to the redirect target, or fails if the promise did not redirect. */
export async function redirectOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof RedirectSignal) return e.url;
    throw e;
  }
  throw new Error("expected a redirect");
}

export function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

export const PASSWORD = "correct-horse";

/** Seeds one user per role plus two stations; returns their ids. */
export async function seedFixtures() {
  const db = testDb();
  const passwordHash = await hashPassword(PASSWORD);
  const users = await db
    .insert(s.users)
    .values([
      { name: "Cora Cajera", username: "cora", passwordHash, role: "cajera" },
      { name: "Admin", username: "admin", passwordHash, role: "admin" },
      { name: "Enca", username: "enca", passwordHash, role: "encargada_delivery" },
    ])
    .returning({ id: s.users.id, username: s.users.username });
  const stations = await db
    .insert(s.stations)
    .values([
      { name: "Mostrador 1", kind: "mostrador" },
      { name: "Delivery", kind: "delivery" },
    ])
    .returning({ id: s.stations.id });
  const id = (u: string) => users.find((x) => x.username === u)!.id;
  return { cora: id("cora"), admin: id("admin"), enca: id("enca"), station: stations[0].id, deliveryStation: stations[1].id };
}

/** `connection()` only works inside a request scope; in tests it is a no-op. */
export const nextServerMock = { connection: async (): Promise<void> => {} };
