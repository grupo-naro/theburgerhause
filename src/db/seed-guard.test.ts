import { describe, expect, it } from "vitest";
import { assertSeedAllowed } from "./seed";

describe("demo seed guard", () => {
  it("allows seeding in development and test", () => {
    expect(() => assertSeedAllowed({ NODE_ENV: "development" })).not.toThrow();
    expect(() => assertSeedAllowed({ NODE_ENV: "test" })).not.toThrow();
    expect(() => assertSeedAllowed({})).not.toThrow();
  });
  it("refuses in production with a loud message pointing to db:init-prod", () => {
    expect(() => assertSeedAllowed({ NODE_ENV: "production" })).toThrow(/NEVER.*production/i);
    expect(() => assertSeedAllowed({ NODE_ENV: "production" })).toThrow(/db:init-prod/);
  });
  it("refuses in production for any ALLOW_DEMO_SEED value other than exactly 1", () => {
    for (const v of ["0", "true", "yes", "", " 1"]) {
      expect(() => assertSeedAllowed({ NODE_ENV: "production", ALLOW_DEMO_SEED: v })).toThrow();
    }
  });
  it("allows production only with ALLOW_DEMO_SEED=1", () => {
    expect(() => assertSeedAllowed({ NODE_ENV: "production", ALLOW_DEMO_SEED: "1" })).not.toThrow();
  });
});
