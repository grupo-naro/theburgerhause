import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

describe("password", () => {
  it("produces a different hash on each call for the same password", async () => {
    const [a, b] = await Promise.all([hashPassword("hunter2-hunter2"), hashPassword("hunter2-hunter2")]);
    expect(a).not.toBe(b);
    expect(a.startsWith("scrypt$16384$8$1$")).toBe(true);
  });

  it("verifies the right password and rejects a wrong one", async () => {
    const hash = await hashPassword("correct horse");
    expect(await verifyPassword("correct horse", hash)).toBe(true);
    expect(await verifyPassword("wrong horse", hash)).toBe(false);
  });

  it("returns false (never throws) for malformed stored values", async () => {
    for (const stored of ["", "x", "scrypt$bad", "scrypt$1$2$3$4$5", "argon2$16384$8$1$AAAA$AAAA", "scrypt$16384$8$1$$"]) {
      expect(await verifyPassword("anything", stored)).toBe(false);
    }
  });

  it("rejects an empty password at hash time", async () => {
    await expect(hashPassword("")).rejects.toThrow();
  });
});
