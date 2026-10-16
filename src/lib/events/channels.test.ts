import { describe, expect, it } from "vitest";
import { ORDERS_CHANNEL, PRINT_CHANNEL, parseEventPayload } from "./channels";

describe("parseEventPayload", () => {
  it("parses a valid orders event", () => {
    const raw = JSON.stringify({ orderId: 7, status: "en_preparacion", event: "status" });
    expect(parseEventPayload(ORDERS_CHANNEL, raw)).toEqual({ orderId: 7, status: "en_preparacion", event: "status" });
  });

  it("keeps the assigned and settled events (dispatch and rendicion)", () => {
    for (const event of ["assigned", "settled"]) {
      const raw = JSON.stringify({ orderId: 3, status: "entregado", event });
      expect(parseEventPayload(ORDERS_CHANNEL, raw)).toEqual({ orderId: 3, status: "entregado", event });
    }
  });

  it("maps unknown event strings to 'updated'", () => {
    const raw = JSON.stringify({ orderId: 7, status: "cancelado", event: "something_new" });
    expect(parseEventPayload(ORDERS_CHANNEL, raw)).toEqual({ orderId: 7, status: "cancelado", event: "updated" });
  });

  it("returns null for garbage, wrong shapes and unknown statuses", () => {
    expect(parseEventPayload(ORDERS_CHANNEL, "not json")).toBeNull();
    expect(parseEventPayload(ORDERS_CHANNEL, "")).toBeNull();
    expect(parseEventPayload(ORDERS_CHANNEL, "null")).toBeNull();
    expect(parseEventPayload(ORDERS_CHANNEL, "[1]")).toBeNull();
    expect(parseEventPayload(ORDERS_CHANNEL, JSON.stringify({ orderId: "7", status: "entregado", event: "created" }))).toBeNull();
    expect(parseEventPayload(ORDERS_CHANNEL, JSON.stringify({ orderId: 7, status: "nope", event: "created" }))).toBeNull();
    expect(parseEventPayload(ORDERS_CHANNEL, JSON.stringify({ orderId: 1.5, status: "entregado", event: "created" }))).toBeNull();
    expect(parseEventPayload(ORDERS_CHANNEL, JSON.stringify({ status: "entregado", event: "created" }))).toBeNull();
  });

  it("parses print events", () => {
    expect(parseEventPayload(PRINT_CHANNEL, JSON.stringify({ jobId: 3, stationId: 1 }))).toEqual({ jobId: 3, stationId: 1 });
    expect(parseEventPayload(PRINT_CHANNEL, JSON.stringify({ jobId: 3 }))).toBeNull();
  });

  it("rejects unknown channels and oversized payloads", () => {
    expect(parseEventPayload("other", "{}")).toBeNull();
    const big = JSON.stringify({ orderId: 1, status: "entregado", event: "x".repeat(9000) });
    expect(parseEventPayload(ORDERS_CHANNEL, big)).toBeNull();
  });
});
