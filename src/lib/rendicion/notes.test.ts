import { describe, expect, it } from "vitest";
import { QUICK_NOTES, applyQuickNote } from "./notes";

describe("quick notes", () => {
  it("offers the five chips in order", () => {
    expect(QUICK_NOTES.map((q) => q.label)).toEqual(["Gastó en nafta", "Cliente no pagó", "Vuelto de más", "Pérdida/robo", "Otro"]);
  });
  it("a chip fills the note when it is empty", () => {
    expect(applyQuickNote("", QUICK_NOTES[0])).toBe("Gastó en nafta");
  });
  it("a chip replaces a previous chip text but keeps free text by appending", () => {
    expect(applyQuickNote("Gastó en nafta", QUICK_NOTES[1])).toBe("Cliente no pagó");
    expect(applyQuickNote("Faltaron 500 del pedido 12", QUICK_NOTES[0])).toBe("Faltaron 500 del pedido 12. Gastó en nafta");
  });
  it("selecting the same chip again does not duplicate it", () => {
    expect(applyQuickNote("Gastó en nafta", QUICK_NOTES[0])).toBe("Gastó en nafta");
  });
  it("Otro clears a chip text so the user writes the reason", () => {
    expect(applyQuickNote("Gastó en nafta", QUICK_NOTES[4])).toBe("");
    expect(applyQuickNote("algo propio", QUICK_NOTES[4])).toBe("algo propio");
  });
  it("never exceeds the 200 character server limit", () => {
    expect(applyQuickNote("x".repeat(195), QUICK_NOTES[1]).length).toBeLessThanOrEqual(200);
  });
});
