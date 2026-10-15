import { describe, expect, it } from "vitest";
import { userInputSchema } from "./schemas";

const base = { name: "Cora", username: "cora", role: "cajera", active: true, password: "12345678" };

describe("userInputSchema", () => {
  it("accepts a valid new user and lowercases the username", () => {
    expect(userInputSchema.parse({ ...base, username: "Cora.Caja-1_" })).toMatchObject({ username: "cora.caja-1_" });
  });
  it("trims name and username; name is 1..80", () => {
    expect(userInputSchema.parse({ ...base, name: "  Cora  ", username: " cora " })).toMatchObject({
      name: "Cora",
      username: "cora",
    });
    expect(userInputSchema.safeParse({ ...base, name: " " }).success).toBe(false);
    expect(userInputSchema.safeParse({ ...base, name: "x".repeat(81) }).success).toBe(false);
  });
  it("username is 3..40 and limited to letters, digits, dot, underscore, dash", () => {
    expect(userInputSchema.safeParse({ ...base, username: "ab" }).success).toBe(false);
    expect(userInputSchema.safeParse({ ...base, username: "a".repeat(41) }).success).toBe(false);
    expect(userInputSchema.safeParse({ ...base, username: "a".repeat(40) }).success).toBe(true);
    for (const username of ["co ra", "cora@x", "córa", "co/ra", "co$ra"]) {
      expect(userInputSchema.safeParse({ ...base, username }).success).toBe(false);
    }
  });
  it("role must be one of the three roles", () => {
    for (const role of ["admin", "cajera", "encargada_delivery"]) {
      expect(userInputSchema.safeParse({ ...base, role }).success).toBe(true);
    }
    expect(userInputSchema.safeParse({ ...base, role: "root" }).success).toBe(false);
    expect(userInputSchema.safeParse({ ...base, role: undefined }).success).toBe(false);
  });
  it("password is required on create, 8..256 characters", () => {
    const noPass = { name: base.name, username: base.username, role: base.role, active: base.active };
    const missing = userInputSchema.safeParse(noPass);
    expect(missing.success).toBe(false);
    expect(userInputSchema.safeParse({ ...base, password: "" }).success).toBe(false);
    expect(userInputSchema.safeParse({ ...base, password: "1234567" }).success).toBe(false);
    expect(userInputSchema.safeParse({ ...base, password: "x".repeat(257) }).success).toBe(false);
    expect(userInputSchema.safeParse({ ...base, password: "x".repeat(256) }).success).toBe(true);
  });
  it("password is optional on edit: blank means unchanged, otherwise 8..256", () => {
    const edit = { ...base, id: 4 };
    expect(userInputSchema.parse({ ...edit, password: "" }).password).toBeUndefined();
    expect(userInputSchema.parse({ ...edit, password: undefined }).password).toBeUndefined();
    expect(userInputSchema.parse({ ...edit, password: "newpass-1" }).password).toBe("newpass-1");
    expect(userInputSchema.safeParse({ ...edit, password: "short" }).success).toBe(false);
  });
  it("does not trim the password", () => {
    expect(userInputSchema.parse({ ...base, password: "  spaced pass  " }).password).toBe("  spaced pass  ");
  });
  it("reports the password issue on the password field", () => {
    const r = userInputSchema.safeParse({ ...base, password: "" });
    expect(!r.success && r.error.issues[0].path).toEqual(["password"]);
  });
});
