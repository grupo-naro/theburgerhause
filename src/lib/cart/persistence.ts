import { z } from "zod";
import { NOTE_MAX, normalizeLine } from "./normalize";
import { MAX_LINES } from "./reducer";
import type { CartLine, CartState } from "./types";

export const CART_STORAGE_KEY = "bh_cart_v1";
const VERSION = 1;

/** The subset of `Storage` we use; `undefined`/`null` means "no storage available". */
export type CartStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const lineSchema = z.object({
  id: z.string().min(1).max(64),
  productId: z.number().int().positive(),
  modifierIds: z.array(z.number().int().positive()).max(30),
  note: z.string().max(NOTE_MAX),
});

const storedSchema = z.object({
  v: z.literal(VERSION),
  lines: z.array(lineSchema).max(MAX_LINES),
  prices: z.record(z.string().max(64), z.number().int().nonnegative()).default({}),
});

export function serializeCart(state: CartState, prices: Record<string, number>): string {
  const ids = new Set(state.lines.map((l) => l.id));
  const kept: Record<string, number> = {};
  for (const [id, price] of Object.entries(prices)) if (ids.has(id)) kept[id] = price;
  return JSON.stringify({ v: VERSION, lines: state.lines, prices: kept });
}

/** Validates untrusted storage content. Returns null on ANY problem; never throws. */
export function parseCart(raw: string | null): { lines: CartLine[]; prices: Record<string, number> } | null {
  if (!raw) return null;
  try {
    const parsed = storedSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    const lines = parsed.data.lines.map(normalizeLine);
    if (new Set(lines.map((l) => l.id)).size !== lines.length) return null;
    return { lines, prices: parsed.data.prices };
  } catch {
    return null;
  }
}

export function loadCart(storage: CartStorage | null | undefined): { lines: CartLine[]; prices: Record<string, number> } | null {
  try {
    return parseCart(storage?.getItem(CART_STORAGE_KEY) ?? null);
  } catch {
    return null;
  }
}

/** Best effort: private mode / quota / denied access degrade to in-memory only. An empty cart removes the key. */
export function saveCart(
  storage: CartStorage | null | undefined,
  state: CartState,
  prices: Record<string, number>,
): void {
  try {
    if (!storage) return;
    if (state.lines.length === 0) storage.removeItem(CART_STORAGE_KEY);
    else storage.setItem(CART_STORAGE_KEY, serializeCart(state, prices));
  } catch {
    /* in-memory only */
  }
}

export function clearCartStorage(storage: CartStorage | null | undefined): void {
  try {
    storage?.removeItem(CART_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
