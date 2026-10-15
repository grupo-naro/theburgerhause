import type { OrderUnitInput } from "@/lib/cart/types";
import { createOrderSchema, fieldErrorsOf, type CreateOrderInput } from "@/lib/orders/schemas";

export type Fulfillment = "delivery" | "takeaway";
export type PaymentMethod = "cash" | "transfer";

/** Raw form state: exactly what the customer typed (the schema trims / normalizes). */
export type CheckoutForm = {
  fulfillment: Fulfillment;
  name: string;
  whatsapp: string;
  address: string;
  crossStreets: string;
  notes: string;
  /** null until a card is chosen. */
  paymentMethod: PaymentMethod | null;
  /** Honeypot, always empty for humans. */
  bh_ref: string;
};

export const EMPTY_FORM: CheckoutForm = {
  fulfillment: "delivery",
  name: "",
  whatsapp: "",
  address: "",
  crossStreets: "",
  notes: "",
  paymentMethod: null,
  bh_ref: "",
};

/** Fields that can show an inline error, in the visual order of the page (also the focus order). */
export const FIELD_ORDER = [
  "delivery.address",
  "delivery.crossStreets",
  "delivery.notes",
  "customer.name",
  "customer.whatsapp",
  "paymentMethod",
] as const;
export type FieldKey = (typeof FIELD_ORDER)[number];
export type FieldErrors = Partial<Record<FieldKey, string>>;

const FIELD_SET: ReadonlySet<string> = new Set(FIELD_ORDER);

/** DOM id of a field's control (`aria-describedby` / focus target derive from it). */
export function fieldId(key: FieldKey): string {
  return `checkout-${key.replace(".", "-")}`;
}

/** What `createOrder` receives. Prices / totals are NOT part of the contract and never sent. */
export type CheckoutInput = {
  idempotencyKey: string;
  units: OrderUnitInput[];
  customer: { name: string; whatsapp: string };
  fulfillment: Fulfillment;
  delivery?: { address: string; crossStreets: string; notes: string };
  paymentMethod?: PaymentMethod;
  bh_ref: string;
};

export function toCreateOrderInput(
  form: CheckoutForm,
  units: readonly OrderUnitInput[],
  idempotencyKey: string,
): CheckoutInput {
  return {
    idempotencyKey,
    units: units.map((u) => ({ productId: u.productId, modifierIds: [...u.modifierIds], note: u.note })),
    customer: { name: form.name, whatsapp: form.whatsapp },
    fulfillment: form.fulfillment,
    ...(form.fulfillment === "delivery"
      ? { delivery: { address: form.address, crossStreets: form.crossStreets, notes: form.notes } }
      : {}),
    paymentMethod: form.paymentMethod ?? undefined,
    bh_ref: form.bh_ref,
  };
}

/** Field errors keyed by dotted path -> known inline fields vs everything else (deduped messages). */
export function splitFieldErrors(errors: Record<string, string> | undefined): { fields: FieldErrors; other: string[] } {
  const fields: FieldErrors = {};
  const other: string[] = [];
  for (const [key, message] of Object.entries(errors ?? {})) {
    if (FIELD_SET.has(key)) fields[key as FieldKey] = message;
    else if (!other.includes(message)) other.push(message);
  }
  return { fields, other };
}

/** Friendlier wording than the schema's generic "Es demasiado corto" when the field is simply empty. */
export function humanizeErrors(fields: FieldErrors, form: CheckoutForm): FieldErrors {
  const empty: Partial<Record<FieldKey, [string, string]>> = {
    "customer.name": [form.name, "Ingresá tu nombre"],
    "delivery.address": [form.address, "Ingresá la dirección de entrega"],
    "delivery.crossStreets": [form.crossStreets, "Ingresá entre qué calles queda"],
    "customer.whatsapp": [form.whatsapp, "Ingresá tu WhatsApp para avisarte de tu pedido"],
  };
  const out: FieldErrors = { ...fields };
  for (const [key, [value, message]] of Object.entries(empty) as [FieldKey, [string, string]][]) {
    if (out[key] && value.trim() === "") out[key] = message;
  }
  return out;
}

export type ValidationResult =
  | { ok: true; input: CreateOrderInput }
  | { ok: false; fields: FieldErrors; other: string[] };

/** Client-side validation with the SAME zod schema as the server (the server stays the authority). */
export function validateForm(
  form: CheckoutForm,
  units: readonly OrderUnitInput[],
  idempotencyKey: string,
): ValidationResult {
  const parsed = createOrderSchema.safeParse(toCreateOrderInput(form, units, idempotencyKey));
  if (parsed.success) return { ok: true, input: parsed.data };
  const { fields, other } = splitFieldErrors(fieldErrorsOf(parsed.error));
  return { ok: false, fields: humanizeErrors(fields, form), other };
}

/** First invalid field in page order (null when none). */
export function firstInvalidField(fields: FieldErrors): FieldKey | null {
  return FIELD_ORDER.find((k) => fields[k]) ?? null;
}
