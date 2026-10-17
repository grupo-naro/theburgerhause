import { describe, expect, it } from "vitest";
import {
  WRONG_SECTOR_MESSAGE,
  actorSectorFor,
  decideSector,
  isWrongSector,
  sectorOfFulfillment,
  sectorOfOrder,
  stationAllowedForRole,
} from "./sector";

describe("sectorOfFulfillment / sectorOfOrder", () => {
  it("delivery orders belong to the delivery sector", () => {
    expect(sectorOfFulfillment("delivery")).toBe("delivery");
  });
  it("takeaway orders belong to the counter (mostrador) sector", () => {
    expect(sectorOfFulfillment("takeaway")).toBe("mostrador");
  });
  it("counter sales (always takeaway) belong to mostrador", () => {
    expect(sectorOfOrder({ channel: "counter", fulfillment: "takeaway" })).toBe("mostrador");
    expect(sectorOfOrder({ channel: "web", fulfillment: "delivery" })).toBe("delivery");
  });
});

describe("actorSectorFor", () => {
  it("admin is exempt (null) whatever the station", () => {
    expect(actorSectorFor("admin", null)).toEqual({ ok: true, sector: null });
    expect(actorSectorFor("admin", "delivery")).toEqual({ ok: true, sector: null });
  });
  it("staff work in the sector of their station kind", () => {
    expect(actorSectorFor("cajera", "mostrador")).toEqual({ ok: true, sector: "mostrador" });
    expect(actorSectorFor("encargada_delivery", "delivery")).toEqual({ ok: true, sector: "delivery" });
  });
  it("staff at a station of the other kind (unsupported combination) cannot act", () => {
    expect(actorSectorFor("cajera", "delivery")).toEqual({ ok: false, code: "WRONG_SECTOR" });
    expect(actorSectorFor("encargada_delivery", "mostrador")).toEqual({ ok: false, code: "WRONG_SECTOR" });
  });
  it("staff without a station cannot act", () => {
    expect(actorSectorFor("cajera", null)).toEqual({ ok: false, code: "STATION_REQUIRED" });
    expect(actorSectorFor("encargada_delivery", null)).toEqual({ ok: false, code: "STATION_REQUIRED" });
  });
});

describe("isWrongSector / decideSector", () => {
  it("a null/undefined actor sector (admin) is never wrong", () => {
    expect(isWrongSector(null, "delivery")).toBe(false);
    expect(isWrongSector(undefined, "takeaway")).toBe(false);
  });
  it("mostrador acting on delivery is wrong, and vice versa", () => {
    expect(isWrongSector("mostrador", "delivery")).toBe(true);
    expect(isWrongSector("delivery", "takeaway")).toBe(true);
    expect(isWrongSector("mostrador", "takeaway")).toBe(false);
    expect(isWrongSector("delivery", "delivery")).toBe(false);
  });
  it("decideSector returns the Spanish WRONG_SECTOR failure", () => {
    expect(decideSector("delivery", "takeaway")).toEqual({ ok: false, code: "WRONG_SECTOR", message: WRONG_SECTOR_MESSAGE });
    expect(decideSector("delivery", "delivery")).toEqual({ ok: true });
    expect(WRONG_SECTOR_MESSAGE).toMatch(/otro sector|estación/i);
  });
});

describe("stationAllowedForRole", () => {
  it("admin may sit anywhere; the cashier at Mostrador, the delivery manager at Delivery", () => {
    expect(stationAllowedForRole("admin", "mostrador")).toBe(true);
    expect(stationAllowedForRole("admin", "delivery")).toBe(true);
    expect(stationAllowedForRole("cajera", "mostrador")).toBe(true);
    expect(stationAllowedForRole("cajera", "delivery")).toBe(false);
    expect(stationAllowedForRole("encargada_delivery", "delivery")).toBe(true);
    expect(stationAllowedForRole("encargada_delivery", "mostrador")).toBe(false);
  });
});
