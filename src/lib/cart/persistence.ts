import { NOTE_MAX, normalizeLine } from "./normalize";
import { MAX_LINES } from "./reducer";
import type { CartLine, CartState } from "./types";

export const CART_STORAGE_KEY = "bh_cart_v1";
const VERSION = 1;
/** Anything bigger than this cannot be a cart we wrote (100 lines are ~20 KB): refuse before JSON.parse. */
const MAX_RAW_LENGTH = 200_000;

/** The subset of `Storage` we use; `undefined`/`null` means "no storage available". */
export type CartStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

// Hand-written validation (not zod): this module is on the critical path of EVERY storefront page and zod
// is ~80 KB of JavaScript. Same rules as the schema it replaces: unknown keys are dropped, anything else invalid -> null.
const isPositiveInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function readLine(v: unknown): CartLine | null {
  if (!isRecord(v)) return null;
  const { id, productId, modifierIds, note } = v;
  if (typeof id !== "string" || id.length < 1 || id.length > 64) return null;
  if (!isPositiveInt(productId)) return null;
  if (!Array.isArray(modifierIds) || modifierIds.length > 30 || !modifierIds.every(isPositiveInt)) return null;
  if (typeof note !== "string" || note.length > NOTE_MAX) return null;
  return { id, productId, modifierIds: [...modifierIds], note };
}

function readPrices(v: unknown): Record<string, number> | null {
  if (v === undefined) return {};
  if (!isRecord(v)) return null;
  const out: Record<string, number> = {};
  for (const [key, price] of Object.entries(v)) {
    if (key.length > 64 || typeof price !== "number" || !Number.isSafeInteger(price) || price < 0) return null;
    if (key !== "__proto__") out[key] = price;
  }
  return out;
}

function readStored(v: unknown): { lines: CartLine[]; prices: Record<string, number> } | null {
  if (!isRecord(v) || v.v !== VERSION || !Array.isArray(v.lines) || v.lines.length > MAX_LINES) return null;
  const lines: CartLine[] = [];
  for (const raw of v.lines) {
    const line = readLine(raw);
    if (!line) return null;
    lines.push(line);
  }
  const prices = readPrices(v.prices);
  return prices ? { lines, prices } : null;
}

export function serializeCart(state: CartState, prices: Record<string, number>): string {
  const ids = new Set(state.lines.map((l) => l.id));
  const kept: Record<string, number> = {};
  for (const [id, price] of Object.entries(prices)) if (ids.has(id)) kept[id] = price;
  return JSON.stringify({ v: VERSION, lines: state.lines, prices: kept });
}

/** Validates untrusted storage content. Returns null on ANY problem; never throws. */
export function parseCart(raw: string | null): { lines: CartLine[]; prices: Record<string, number> } | null {
  if (!raw || raw.length > MAX_RAW_LENGTH) return null;
  try {
    const parsed = readStored(JSON.parse(raw));
    if (!parsed) return null;
    const lines = parsed.lines.map(normalizeLine);
    if (new Set(lines.map((l) => l.id)).size !== lines.length) return null;
    return { lines, prices: parsed.prices };
  } catch {
    return null;
  }
}

export function loadCart(
  storage: CartStorage | null | undefined,
  key: string = CART_STORAGE_KEY,
): { lines: CartLine[]; prices: Record<string, number> } | null {
  try {
    return parseCart(storage?.getItem(key) ?? null);
  } catch {
    return null;
  }
}

/** Best effort: private mode / quota / denied access degrade to in-memory only. An empty cart removes the key. */
export function saveCart(
  storage: CartStorage | null | undefined,
  state: CartState,
  prices: Record<string, number>,
  key: string = CART_STORAGE_KEY,
): void {
  try {
    if (!storage) return;
    if (state.lines.length === 0) storage.removeItem(key);
    else storage.setItem(key, serializeCart(state, prices));
  } catch {
    /* in-memory only */
  }
}

export function clearCartStorage(storage: CartStorage | null | undefined, key: string = CART_STORAGE_KEY): void {
  try {
    storage?.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Does a `storage` event concern this cart? (`key === null` means the whole storage was cleared.) */
export function isCartStorageEvent(eventKey: string | null, key: string): boolean {
  return eventKey === null || eventKey === key;
}
