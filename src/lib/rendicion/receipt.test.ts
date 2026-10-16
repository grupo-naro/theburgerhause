import { describe, expect, it } from "vitest";
import { buildReceipt, formatSettledAt, mismatchMessage, type ReceiptSource } from "./receipt";

const src: ReceiptSource = {
  id: 42,
  cadetName: "Nahuel",
  amount: 30_000_00,
  receivedAmount: 28_500_00,
  shortage: 1_500_00,
  orderCount: 3,
  orders: [
    { id: 1, number: 7, total: 10_000_00 },
    { id: 2, number: 9, total: 12_000_00 },
    { id: 3, number: 12, total: 8_000_00 },
  ],
  settledByName: "Encargada",
  note: "Gastó en nafta",
  createdAt: "2026-10-16T17:05:00.000Z", // 14:05 in Buenos Aires (UTC-3)
};
const norm = (s: string) => s.replace(/\s/g, " ");

describe("buildReceipt", () => {
  it("builds labels and numbers", () => {
    const r = buildReceipt(src);
    expect(r.title).toBe("Rendición #42");
    expect(r.cadetName).toBe("Nahuel");
    expect(r.dateLabel).toBe("16/10/2026 14:05");
    expect(r.ordersLabel).toBe("3 pedidos");
    expect(r.orderNumbers).toEqual(["#7", "#9", "#12"]);
    expect(norm(r.expected)).toBe("$ 30.000");
    expect(norm(r.received)).toBe("$ 28.500");
    expect(norm(r.shortage)).toBe("$ 1.500");
    expect(r.hasShortage).toBe(true);
    expect(r.settledBy).toBe("Encargada");
    expect(r.note).toBe("Gastó en nafta");
  });
  it("exact settlement: no shortage, singular order, missing names", () => {
    const r = buildReceipt({ ...src, receivedAmount: src.amount, shortage: 0, orderCount: 1, orders: [src.orders[0]], settledByName: null, note: null });
    expect(r.hasShortage).toBe(false);
    expect(r.ordersLabel).toBe("1 pedido");
    expect(r.settledBy).toBe("—");
    expect(r.note).toBeNull();
  });
  it("uses a 24-hour clock in Argentina time (midnight is 00:xx, never 24:xx)", () => {
    expect(buildReceipt({ ...src, createdAt: "2026-10-16T03:07:00.000Z" }).dateLabel).toBe("16/10/2026 00:07");
    expect(buildReceipt({ ...src, createdAt: "2026-10-16T02:59:00.000Z" }).dateLabel).toBe("15/10/2026 23:59");
  });
  it("an unparsable date degrades to a dash", () => {
    expect(buildReceipt({ ...src, createdAt: "nope" }).dateLabel).toBe("—");
  });
});

describe("formatSettledAt", () => {
  const now = new Date("2026-10-16T20:00:00.000Z"); // 17:00 in Buenos Aires
  it("never", () => expect(formatSettledAt(null, now)).toBe("Nunca"));
  it("today / yesterday / older", () => {
    expect(formatSettledAt("2026-10-16T17:05:00.000Z", now)).toBe("hoy 14:05");
    expect(formatSettledAt("2026-10-15T23:30:00.000Z", now)).toBe("ayer 20:30");
    expect(formatSettledAt("2026-10-10T15:00:00.000Z", now)).toBe("10/10 12:00");
  });
  it("uses the Argentina calendar day, not UTC", () => {
    // 01:00Z on the 17th is still the 16th at 22:00 in Buenos Aires.
    expect(formatSettledAt("2026-10-17T01:00:00.000Z", new Date("2026-10-17T02:00:00.000Z"))).toBe("hoy 22:00");
  });
});

describe("mismatchMessage", () => {
  it("states before, after and the order count", () => {
    expect(norm(mismatchMessage({ expected: 10_000_00, actual: 18_000_00, orderCount: 3 }))).toBe(
      "El saldo cambió: antes $ 10.000, ahora $ 18.000 (3 pedidos). Revisá la lista y volvé a confirmar",
    );
    expect(norm(mismatchMessage({ expected: 10_000_00, actual: 8_000_00, orderCount: 1 }))).toContain("(1 pedido)");
  });
});
