import { z } from "zod";

/**
 * The neutral document the server renders (src/domain/print-document.ts). Duplicated on purpose: the
 * agent must not import from the Next app. packages/print-agent/contract.test.ts keeps both in sync.
 */
export type PrintBlock =
  | { type: "text"; text: string; bold?: boolean; size?: 1 | 2; align?: "left" | "center" }
  | { type: "divider" }
  | { type: "cut" };
export type PrintDocument = { blocks: PrintBlock[] };

export const MAX_BLOCKS = 500;
export const MAX_TEXT_CHARS = 2_000;

const textBlock = z.object({
  type: z.literal("text"),
  text: z.string().max(MAX_TEXT_CHARS),
  bold: z.boolean().optional(),
  size: z.union([z.literal(1), z.literal(2)]).optional(),
  align: z.enum(["left", "center"]).optional(),
});

export const printDocumentSchema = z.object({
  blocks: z
    .array(z.discriminatedUnion("type", [textBlock, z.object({ type: z.literal("divider") }), z.object({ type: z.literal("cut") })]))
    .max(MAX_BLOCKS),
});
