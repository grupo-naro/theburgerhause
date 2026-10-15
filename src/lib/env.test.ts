import { describe, expect, it } from "vitest";
import { parseEnv } from "@/lib/env";

const valid = {
  DATABASE_URL: "postgres://u:p@localhost:15435/db",
  SESSION_SECRET: "x".repeat(32),
  UPLOAD_DIR: "./.uploads",
};

describe("parseEnv", () => {
  it("fails without DATABASE_URL naming the variable", () => {
    const { DATABASE_URL: _omit, ...rest } = valid;
    void _omit;
    expect(() => parseEnv(rest)).toThrow(/DATABASE_URL/);
  });
  it("fails with a too-short SESSION_SECRET", () => {
    expect(() => parseEnv({ ...valid, SESSION_SECRET: "short" })).toThrow(/SESSION_SECRET/);
  });
  it("fails without UPLOAD_DIR naming the variable", () => {
    const { UPLOAD_DIR: _omit, ...rest } = valid;
    void _omit;
    expect(() => parseEnv(rest)).toThrow(/UPLOAD_DIR/);
  });
  it("fails with a non-postgres DATABASE_URL scheme naming the variable", () => {
    expect(() => parseEnv({ ...valid, DATABASE_URL: "mysql://u:p@localhost:3306/db" })).toThrow(
      /DATABASE_URL/,
    );
  });
  it("passes with all three valid", () => {
    expect(parseEnv(valid)).toEqual(valid);
  });
});
