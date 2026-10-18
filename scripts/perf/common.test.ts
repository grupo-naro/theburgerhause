import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs helper without declarations
import { assertLocalDatabase, serverEnv } from "./common.mjs";

describe("perf scripts host guard", () => {
  it("accepts this machine only", () => {
    for (const u of ["postgres://u:p@localhost:15435/db", "postgres://u:p@127.0.0.1/db", "postgres://u:p@[::1]:5432/db"]) {
      expect(() => assertLocalDatabase(u)).not.toThrow();
    }
  });
  it("refuses a remote host unless --allow-remote, and names it", () => {
    expect(() => assertLocalDatabase("postgres://u:p@db.prod.example.com:5432/bh")).toThrow(/db.prod.example.com/);
    expect(() => assertLocalDatabase("not a url")).toThrow();
    expect(() => assertLocalDatabase("postgres://u:p@db.prod.example.com/bh", true)).not.toThrow();
  });
  it("the spawned server gets an allow-listed environment, not the whole shell", () => {
    process.env.SOME_CLOUD_SECRET = "leak";
    try {
      const env = serverEnv({ testUrl: "t", serverUrl: "s", uploadDir: "u", port: 3100 });
      expect(env.SOME_CLOUD_SECRET).toBeUndefined();
      expect(env.DATABASE_URL).toBe("t");
      expect(env.NODE_ENV).toBe("production");
    } finally {
      delete process.env.SOME_CLOUD_SECRET;
    }
  });
});
