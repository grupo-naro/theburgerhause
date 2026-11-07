import { describe, expect, it } from "vitest";
import { pinInputSchema } from "./schemas";

const ok = (pin: string, pinConfirm = pin, password = "x") => pinInputSchema.safeParse({ pin, pinConfirm, password });
const msg = (r: ReturnType<typeof ok>, field: string) => (r.success ? undefined : r.error.issues.find((i) => i.path[0] === field)?.message);

describe("pinInputSchema", () => {
  it.each(["1234", "123456"])("accepts %s", (pin) => expect(ok(pin).success).toBe(true));
  it.each(["123", "1234567", "12a4", ""])("rejects %s", (pin) => expect(msg(ok(pin, pin), "pin")).toBe("El PIN tiene que tener de 4 a 6 números"));
  it("rejects a mismatched confirmation", () => expect(msg(ok("1234", "1235"), "pinConfirm")).toBe("Los PIN no coinciden"));
  it("requires the password", () => expect(msg(ok("1234", "1234", ""), "password")).toBe("Ingresá tu contraseña"));
});
