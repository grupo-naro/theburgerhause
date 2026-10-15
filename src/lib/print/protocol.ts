import { z } from "zod";
import { isWellFormedStationToken } from "@/lib/stations/token";

/** Print Agent wire protocol (docs/ops/print-agent-protocol.md). No next/*: shared by routes and tests. */

export const PROTOCOL_VERSION = 1;
export const MAX_ATTEMPTS = 3;
export const STUCK_AFTER_MS = 30_000;
export const MAX_ERROR_CHARS = 300;
/** Raw bound on the agent-supplied error before it is cleaned and truncated. */
const MAX_RAW_ERROR_CHARS = 2_000;

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

export const ackBodySchema = z.object({
  status: z.enum(["done", "failed"]),
  error: z
    .string()
    .max(MAX_RAW_ERROR_CHARS)
    .optional()
    .transform((e) => {
      const clean = (e ?? "").replace(CONTROL_CHARS, "").slice(0, MAX_ERROR_CHARS);
      return clean.length > 0 ? clean : null;
    }),
});
export type AckBody = z.infer<typeof ackBodySchema>;

/** Mirrors PrintDocument / PrintBlock (src/domain/print-document.ts) with sane bounds. */
const textBlock = z.object({
  type: z.literal("text"),
  text: z.string().max(2_000),
  bold: z.boolean().optional(),
  size: z.union([z.literal(1), z.literal(2)]).optional(),
  align: z.enum(["left", "center"]).optional(),
});
export const printDocumentSchema = z.object({
  blocks: z
    .array(z.discriminatedUnion("type", [textBlock, z.object({ type: z.literal("divider") }), z.object({ type: z.literal("cut") })]))
    .max(500),
});

/**
 * One SSE frame. `JSON.stringify` never emits a raw CR/LF, so the data stays on ONE line and a
 * payload can not inject extra fields or events. The event name is validated, not escaped.
 */
export function sseFrame(event: string, data: unknown): string {
  if (!/^[a-z][a-z0-9_-]*$/i.test(event)) throw new Error("invalid SSE event name");
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** The candidate token of `Authorization: Bearer <token>`, or null when absent/garbled/not shaped like a station token. */
export function parseBearerToken(header: string | null | undefined): string | null {
  if (typeof header !== "string") return null;
  const m = /^bearer[ \t]+(\S+)[ \t]*$/i.exec(header);
  return m && isWellFormedStationToken(m[1]) ? m[1] : null;
}
