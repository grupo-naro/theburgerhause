import { signature } from "@/lib/cart/signature";
import type { OrderUnitInput } from "@/lib/cart/types";
import type { CheckoutForm } from "./form";

/** sessionStorage key of the checkout idempotency key (one per tab session). */
export const CHECKOUT_KEY_STORAGE = "bh_checkout_key_v1";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type KeyStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Identity of the cart CONTENTS (order of lines irrelevant): a different cart is a different order. */
export function cartSignature(units: readonly OrderUnitInput[]): string {
  return units
    .map((u) => signature(u))
    .sort()
    .join("\n");
}

const squash = (v: string) => v.replace(/\s+/g, " ").trim();

/**
 * Identity of the WHOLE order: cart contents plus every order-defining form field. Editing any of them
 * after a lost response yields a new key (a new order) instead of replaying the old order with the old
 * address / payment. An unchanged retry keeps the key.
 */
export function orderSignature(units: readonly OrderUnitInput[], form: CheckoutForm): string {
  const delivery = form.fulfillment === "delivery" ? [squash(form.address), squash(form.crossStreets), squash(form.notes)] : [];
  return JSON.stringify([
    cartSignature(units),
    form.fulfillment,
    form.paymentMethod,
    squash(form.name),
    form.whatsapp.replace(/\D/g, ""),
    ...delivery,
  ]);
}

const randomKey = () => crypto.randomUUID();

/**
 * One idempotency key per checkout session: stable across retries, double clicks and reloads
 * (sessionStorage, with an in-memory fallback when storage is unavailable), regenerated when the
 * cart contents change or after `clear()` (successful order). Never throws.
 */
export function createKeyHolder(storage: KeyStorage | null | undefined, newKey: () => string = randomKey) {
  let memory: { k: string; s: string } | null = null;

  const readStored = (): { k: string; s: string } | null => {
    try {
      const raw = storage?.getItem(CHECKOUT_KEY_STORAGE);
      if (!raw) return null;
      const v = JSON.parse(raw) as unknown;
      if (typeof v !== "object" || v === null) return null;
      const { k, s } = v as { k?: unknown; s?: unknown };
      return typeof k === "string" && UUID_V4.test(k) && typeof s === "string" ? { k, s } : null;
    } catch {
      return null;
    }
  };

  return {
    get(sig: string): string {
      const found = readStored() ?? memory;
      if (found && found.s === sig) {
        memory = found;
        return found.k;
      }
      const entry = { k: newKey(), s: sig };
      memory = entry;
      try {
        storage?.setItem(CHECKOUT_KEY_STORAGE, JSON.stringify(entry));
      } catch {
        // memory fallback
      }
      return entry.k;
    },
    clear(): void {
      memory = null;
      try {
        storage?.removeItem(CHECKOUT_KEY_STORAGE);
      } catch {
        // ignore
      }
    },
  };
}
