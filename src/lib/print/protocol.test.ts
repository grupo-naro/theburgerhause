import { describe, expect, it } from "vitest";
import { ackBodySchema, parseBearerToken, printDocumentSchema, sseFrame } from "./protocol";

describe("ackBodySchema", () => {
  it("accepts done and failed, with or without an error", () => {
    expect(ackBodySchema.parse({ status: "done" })).toEqual({ status: "done", error: null });
    expect(ackBodySchema.parse({ status: "failed", error: "sin papel" })).toEqual({ status: "failed", error: "sin papel" });
  });

  it("rejects other statuses, missing status and non-objects", () => {
    for (const bad of [{ status: "pending" }, { status: "printing" }, { status: "" }, {}, null, "done", [], { status: 1 }]) {
      expect(ackBodySchema.safeParse(bad).success).toBe(false);
    }
  });

  it("strips control characters (newlines, NUL, ESC, C1) from the error", () => {
    const r = ackBodySchema.parse({ status: "failed", error: "a\nb\r\tc\u0000d\u001be\u0085f\u007fg" });
    expect(r.error).toBe("abcdefg");
  });

  it("truncates the error to 300 characters but rejects absurd sizes", () => {
    expect(ackBodySchema.parse({ status: "failed", error: "x".repeat(300) }).error).toHaveLength(300);
    expect(ackBodySchema.parse({ status: "failed", error: "x".repeat(900) }).error).toHaveLength(300);
    expect(ackBodySchema.safeParse({ status: "failed", error: "x".repeat(2001) }).success).toBe(false);
  });

  it("an error that is empty after stripping becomes null; non-strings are rejected", () => {
    expect(ackBodySchema.parse({ status: "failed", error: "\n\t" }).error).toBeNull();
    expect(ackBodySchema.safeParse({ status: "failed", error: 5 }).success).toBe(false);
  });
});

describe("printDocumentSchema", () => {
  it("accepts what the renderers produce", () => {
    const doc = {
      blocks: [
        { type: "text", text: "PEDIDO #1", bold: true, size: 2, align: "center" },
        { type: "text", text: "x" },
        { type: "divider" },
        { type: "cut" },
      ],
    };
    expect(printDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it("rejects malformed documents", () => {
    for (const bad of [
      null,
      {},
      { blocks: "x" },
      { blocks: [{ type: "image" }] },
      { blocks: [{ type: "text" }] },
      { blocks: [{ type: "text", text: "a", size: 3 }] },
      { blocks: [{ type: "text", text: "a", align: "right" }] },
      { blocks: [{ type: "text", text: 5 }] },
      { blocks: Array.from({ length: 501 }, () => ({ type: "cut" })) },
      { blocks: [{ type: "text", text: "x".repeat(2001) }] },
    ]) {
      expect(printDocumentSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe("sseFrame", () => {
  it("builds event + single-line data + blank line", () => {
    expect(sseFrame("job", { id: 1 })).toBe('event: job\ndata: {"id":1}\n\n');
  });

  it("newlines inside strings cannot break the frame", () => {
    const f = sseFrame("job", { text: "a\n\nevent: evil\r\ndata: x y" });
    expect(f.endsWith("\n\n")).toBe(true);
    expect(f.slice(0, -2)).not.toMatch(/[\r\n]\s*event:/);
    expect(f.slice(0, -2).split("\n")).toHaveLength(2);
    expect(f.includes("\r")).toBe(false);
  });

  it("refuses event names that could inject lines", () => {
    expect(() => sseFrame("a\nb", {})).toThrow();
    expect(() => sseFrame("", {})).toThrow();
    expect(() => sseFrame("a:b", {})).toThrow();
  });
});

const TOKEN = `bhst_${"a".repeat(43)}`;

describe("parseBearerToken", () => {
  it("extracts a well-formed station token (scheme case-insensitive, extra spaces tolerated)", () => {
    expect(parseBearerToken(`Bearer ${TOKEN}`)).toBe(TOKEN);
    expect(parseBearerToken(`bearer ${TOKEN}`)).toBe(TOKEN);
    expect(parseBearerToken(`BEARER   ${TOKEN}  `)).toBe(TOKEN);
  });

  it("returns null for missing, other schemes, garbage and malformed tokens", () => {
    for (const bad of [
      null,
      undefined,
      "",
      "Bearer",
      "Bearer ",
      TOKEN,
      `Basic ${TOKEN}`,
      `Bearer ${TOKEN} extra`,
      "Bearer bhst_short",
      `Bearer ${TOKEN}x`,
      `Bearer ${"b".repeat(48)}`,
      `Bearer ${TOKEN.slice(0, -1)}!`,
      `Bearer\n${TOKEN}`,
    ]) {
      expect(parseBearerToken(bad)).toBeNull();
    }
  });
});
