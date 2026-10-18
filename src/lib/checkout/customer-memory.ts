/** localStorage key of the "remember me" data. Only name, WhatsApp and the delivery fields. */
export const CUSTOMER_STORAGE_KEY = "bh_customer_v1";
const VERSION = 1;
/** A record we wrote is < 1 KB; anything this big is not ours: refuse before JSON.parse. */
const MAX_RAW_LENGTH = 10_000;

/** The subset of `Storage` we use; `null`/`undefined` means "no storage available". */
export type MemoryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

// Hand-written validation (not zod): checkout is a critical page and zod is ~80 KB of JavaScript.
const LIMITS = { name: 80, whatsapp: 40, address: 160, crossStreets: 120, notes: 300 } as const;

export type RememberedCustomer = {
  name: string;
  whatsapp: string;
  address: string;
  crossStreets: string;
  notes: string;
};

/** Only the five remembered fields are ever written (never payment data, never anything else). */
export function serializeCustomer(c: RememberedCustomer): string {
  return JSON.stringify({
    v: VERSION,
    name: c.name,
    whatsapp: c.whatsapp,
    address: c.address,
    crossStreets: c.crossStreets,
    notes: c.notes,
  });
}

/** Validates untrusted storage content. Returns null on ANY problem; never throws. */
export function parseCustomer(raw: string | null): RememberedCustomer | null {
  if (!raw || raw.length > MAX_RAW_LENGTH) return null;
  try {
    const r: unknown = JSON.parse(raw);
    if (typeof r !== "object" || r === null || Array.isArray(r) || (r as { v?: unknown }).v !== VERSION) return null;
    const o = r as Record<string, unknown>;
    for (const [field, max] of Object.entries(LIMITS)) {
      if (typeof o[field] !== "string" || (o[field] as string).length > max) return null;
    }
    return {
      name: o.name as string,
      whatsapp: o.whatsapp as string,
      address: o.address as string,
      crossStreets: o.crossStreets as string,
      notes: o.notes as string,
    };
  } catch {
    return null;
  }
}

export function loadCustomer(storage: MemoryStorage | null | undefined): RememberedCustomer | null {
  try {
    return parseCustomer(storage?.getItem(CUSTOMER_STORAGE_KEY) ?? null);
  } catch {
    return null;
  }
}

const isBlank = (c: RememberedCustomer) =>
  [c.name, c.whatsapp, c.address, c.crossStreets, c.notes].every((v) => v.trim() === "");

/** Best effort: private mode / quota errors are swallowed. An entirely empty form is not stored. */
export function saveCustomer(storage: MemoryStorage | null | undefined, c: RememberedCustomer): void {
  try {
    if (isBlank(c)) return;
    storage?.setItem(CUSTOMER_STORAGE_KEY, serializeCustomer(c));
  } catch {
    // ignore
  }
}

export function forgetCustomer(storage: MemoryStorage | null | undefined): void {
  try {
    storage?.removeItem(CUSTOMER_STORAGE_KEY);
  } catch {
    // ignore
  }
}
