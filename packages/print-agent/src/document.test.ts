import { describe, expect, it } from "vitest";
import { printDocumentSchema } from "./document";

describe("printDocumentSchema", () => {
  it("accepts the logo block", () => {
    expect(printDocumentSchema.safeParse({ blocks: [{ type: "logo" }, { type: "cut" }] }).success).toBe(true);
  });

  it("accepts block types it does not know (a newer server): they are skipped when printing, the job is not rejected", () => {
    const r = printDocumentSchema.safeParse({ blocks: [{ type: "text", text: "a" }, { type: "qr", data: "x" }, { type: "cut" }] });
    expect(r.success).toBe(true);
  });

  it("still rejects malformed KNOWN blocks and non-documents", () => {
    for (const bad of [{ blocks: [{ type: "text" }] }, { blocks: [{ type: "text", text: "a", size: 3 }] }, { blocks: [{ type: 5 }] }, { blocks: "x" }, null, []]) {
      expect(printDocumentSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});
