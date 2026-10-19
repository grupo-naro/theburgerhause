import { describe, expect, it } from "vitest";
import { capabilitiesFor } from "./roles";

describe("capabilitiesFor", () => {
  it.each([
    ["admin", { canAssign: true, canControlDelivery: true, canRender: true, canControlCounter: true }],
    ["encargada_delivery", { canAssign: true, canControlDelivery: true, canRender: true, canControlCounter: true }],
    ["encargado", { canAssign: true, canControlDelivery: true, canRender: true, canControlCounter: true }],
    ["cajera", { canAssign: false, canControlDelivery: false, canRender: false, canControlCounter: true }],
  ] as const)("%s", (role, caps) => expect(capabilitiesFor(role)).toEqual(caps));
});
