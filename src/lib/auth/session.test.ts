import { afterEach, describe, expect, it, vi } from "vitest";

const set = vi.fn();
vi.mock("next/headers", () => ({ cookies: async () => ({ set, get: vi.fn(), delete: vi.fn() }) }));
vi.mock("@/db/client", () => ({ getDb: vi.fn() }));

import { SESSION_COOKIE, setSessionCookie } from "@/lib/auth/session";

afterEach(() => {
  set.mockClear();
  vi.unstubAllEnvs();
});

describe("setSessionCookie", () => {
  it.each([
    ["development", false],
    ["production", true],
  ])("sets hardened flags and a 30-day maxAge (NODE_ENV=%s)", async (env, secure) => {
    vi.stubEnv("NODE_ENV", env);
    await setSessionCookie("tok");
    expect(set).toHaveBeenCalledWith(SESSION_COOKIE, "tok", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure,
      maxAge: 2592000,
    });
  });
});
