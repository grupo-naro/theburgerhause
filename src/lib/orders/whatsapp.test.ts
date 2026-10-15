import { describe, expect, it } from "vitest";
import { normalizeWhatsapp, WHATSAPP_MESSAGE } from "./whatsapp";

describe("normalizeWhatsapp", () => {
  it.each([
    ["11 5555-1234", "1155551234"],
    ["(011) 5555-1234", "01155551234"],
    ["+54 9 11 5555-1234", "5491155551234"],
    ["  1155551234  ", "1155551234"],
    ["11.5555.1234", "1155551234"],
    ["15 5555 1234", "1555551234"], // "15" prefix is NOT rewritten
    ["12345678", "12345678"], // 8 digits: lower bound
    ["123456789012345", "123456789012345"], // 15 digits: upper bound
  ])("accepts %j -> %s", (raw, digits) => {
    expect(normalizeWhatsapp(raw)).toEqual({ ok: true, digits });
  });

  it.each([
    ["", "empty"],
    ["1234567", "7 digits"],
    ["1234567890123456", "16 digits"],
    ["abcdefghij", "letters only"],
    ["----", "no digits"],
  ])("rejects %j (%s)", (raw) => {
    expect(normalizeWhatsapp(raw)).toEqual({ ok: false });
  });

  it("strips letters mixed in and judges the digits that remain", () => {
    expect(normalizeWhatsapp("11 5555 1234 int")).toEqual({ ok: true, digits: "1155551234" });
    expect(normalizeWhatsapp("ab12cd")).toEqual({ ok: false });
  });

  it("exposes the user-facing message", () => {
    expect(WHATSAPP_MESSAGE).toBe("Ingresá un número de WhatsApp válido (solo números, con característica)");
  });
});
