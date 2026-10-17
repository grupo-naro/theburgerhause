import { z } from "zod";

/**
 * The neutral document the server renders (src/domain/print-document.ts). Duplicated on purpose: the
 * agent must not import from the Next app. packages/print-agent/contract.test.ts keeps both in sync.
 */
export type PrintBlock =
  | { type: "text"; text: string; bold?: boolean; size?: 1 | 2; align?: "left" | "center" }
  | { type: "divider" }
  | { type: "logo" }
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

const KNOWN_TYPES = ["text", "divider", "logo", "cut"];

/**
 * A block type this agent does not know (a newer server): accepted here and skipped by the ESC/POS translator,
 * so a server update never makes an older agent fail a whole ticket. Malformed KNOWN blocks are still rejected.
 */
const unknownBlock = z.looseObject({ type: z.string().refine((t) => !KNOWN_TYPES.includes(t)) });

export const printDocumentSchema = z.object({
  blocks: z
    .array(
      z.union([
        z.discriminatedUnion("type", [
          textBlock,
          z.object({ type: z.literal("divider") }),
          z.object({ type: z.literal("logo") }),
          z.object({ type: z.literal("cut") }),
        ]),
        unknownBlock,
      ]),
    )
    .max(MAX_BLOCKS),
});
