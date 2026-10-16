import { describe, expect, it } from "vitest";
import { canConfirm, shouldCloseConfirm, type ConfirmState } from "./confirm";

const base: ConfirmState = { orderCount: 3, expected: 30_000_00, received: { ok: true, cents: 30_000_00 }, note: "", inFlight: false };
const check = (s: Partial<ConfirmState>) => canConfirm({ ...base, ...s });
const no = (reason: string) => ({ ok: false, reason });

describe("canConfirm", () => {
  it("exact amount without a note is fine", () => {
    expect(check({})).toEqual({ ok: true });
  });
  it("exact amount with a note is fine", () => {
    expect(check({ note: "Todo bien" })).toEqual({ ok: true });
  });
  it("a request in flight blocks everything", () => {
    expect(check({ inFlight: true })).toEqual(no("Guardando la rendición…"));
  });
  it("no orders: nothing to settle", () => {
    expect(check({ orderCount: 0, expected: 0, received: { ok: true, cents: 0 } })).toEqual(
      no("Este cadete no tiene efectivo pendiente de rendir"),
    );
  });
  it("empty amount", () => {
    expect(check({ received: { ok: false, reason: "empty" } })).toEqual(no("Ingresá el efectivo recibido"));
  });
  it("invalid / negative / too big amounts", () => {
    for (const reason of ["invalid", "negative", "too_big"] as const) {
      expect(check({ received: { ok: false, reason } })).toEqual(no("El efectivo recibido no es un monto válido"));
    }
  });
  it("more than expected", () => {
    expect(check({ received: { ok: true, cents: 30_000_01 } })).toEqual(no("No puede ser más que lo que debe rendir"));
  });
  it("one centavo short needs a note of at least 3 characters", () => {
    const short = { received: { ok: true as const, cents: 30_000_00 - 1 } };
    const need = no("Explicá el faltante en la nota (mínimo 3 letras)");
    expect(check({ ...short, note: "" })).toEqual(need);
    expect(check({ ...short, note: "  ab  " })).toEqual(need);
    expect(check({ ...short, note: "abc" })).toEqual({ ok: true });
    expect(check({ ...short, note: "  abc " })).toEqual({ ok: true });
  });
  it("zero received is a valid (total) shortage with a note", () => {
    expect(check({ received: { ok: true, cents: 0 }, note: "" }).ok).toBe(false);
    expect(check({ received: { ok: true, cents: 0 }, note: "No pagó" })).toEqual({ ok: true });
  });
  it("in-flight wins over any other reason", () => {
    expect(check({ inFlight: true, orderCount: 0 })).toEqual(no("Guardando la rendición…"));
  });
});

describe("shouldCloseConfirm", () => {
  it("closes only when the expected amount moved", () => {
    expect(shouldCloseConfirm(100, 100)).toBe(false);
    expect(shouldCloseConfirm(100, 101)).toBe(true);
    expect(shouldCloseConfirm(100, 0)).toBe(true);
  });
});
