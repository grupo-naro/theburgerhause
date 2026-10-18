import { describe, expect, it } from "vitest";
import { scryptSync, randomBytes } from "node:crypto";
import { hashPassword, needsRehash, verifyPassword } from "@/lib/auth/password";

/** A hash exactly as Task 2.2 produced them (N=16384, r=8, p=1). */
function legacyHash(plain: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(plain, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString("base64")}$${key.toString("base64")}`;
}

describe("password", () => {
  it("produces a different hash on each call for the same password", async () => {
    const [a, b] = await Promise.all([hashPassword("hunter2-hunter2"), hashPassword("hunter2-hunter2")]);
    expect(a).not.toBe(b);
    expect(a.startsWith("scrypt$32768$8$3$")).toBe(true);
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

  it("still verifies hashes made with the legacy parameters and flags them for rehash", async () => {
    const legacy = legacyHash("old password");
    expect(await verifyPassword("old password", legacy)).toBe(true);
    expect(await verifyPassword("other", legacy)).toBe(false);
    expect(needsRehash(legacy)).toBe(true);
    expect(needsRehash(await hashPassword("new password"))).toBe(false);
  });

  it("rejects parameter sets it does not produce (also bounds CPU and memory)", async () => {
    const salt = randomBytes(16);
    const key = scryptSync("x", salt, 64, { N: 1024, r: 8, p: 1 });
    expect(await verifyPassword("x", `scrypt$1024$8$1$${salt.toString("base64")}$${key.toString("base64")}`)).toBe(false);
    expect(needsRehash("garbage")).toBe(false);
    expect(needsRehash("")).toBe(false);
  });
});
