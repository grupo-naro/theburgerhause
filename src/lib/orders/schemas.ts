import { z } from "zod";
import { normalizeWhatsapp, WHATSAPP_MESSAGE } from "./whatsapp";

/**
 * `createOrder` input contract. Objects are NOT strict: unknown keys (a forged
 * `total`, `price`, `status`...) are silently STRIPPED so they can never reach
 * the order logic. Shared by the checkout form (client) and the server.
 */

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Dangerous in tickets / UI: C0 + C1 controls and every Unicode format char (Cf: BOM, bidi
// overrides U+202A-202E, isolates U+2066-2069, zero-width space...), EXCEPT ZWJ U+200D and
// ZWNJ U+200C, which emoji sequences and some scripts need.
const STRIP = /(?![\u200c\u200d])[\x00-\x1f\x7f-\x9f\p{Cf}]/gu;
// Whitespace-like controls and line/paragraph separators (Zl/Zp) become a plain space.
const SPACEY = /[\t\n\r\p{Zl}\p{Zp}]+/gu;

/** Free text: spacey controls -> one space, other controls removed, then trimmed. */
export function cleanText(s: string): string {
  return s.replace(SPACEY, " ").replace(STRIP, "").trim();
}

const INT4_MAX = 2_147_483_647;
const BAD_TEXT = "Dato inválido";
const BAD_ID = "Producto inválido";

const text = (min: number, max: number) =>
  z
    .string({ error: BAD_TEXT })
    .transform(cleanText)
    .pipe(z.string().min(min, min > 0 ? "Es demasiado corto" : undefined).max(max, "Es demasiado largo"));

const unitSchema = z.object({
  productId: z.number({ error: BAD_ID }).int(BAD_ID).positive(BAD_ID).max(INT4_MAX, BAD_ID),
  modifierIds: z
    .array(z.number({ error: BAD_ID }).int(BAD_ID).positive(BAD_ID).max(INT4_MAX, BAD_ID), { error: BAD_ID })
    .max(30, BAD_ID),
  note: text(0, 140),
});

const customerSchema = z.object(
  {
    name: text(2, 80),
    whatsapp: z.string({ error: WHATSAPP_MESSAGE }).transform((raw, ctx) => {
      const r = normalizeWhatsapp(raw);
      if (!r.ok) {
        ctx.issues.push({ code: "custom", message: WHATSAPP_MESSAGE, input: raw });
        return z.NEVER;
      }
      return r.digits;
    }),
  },
  { error: "Completá tus datos" },
);

const deliverySchema = z.object({
  address: text(5, 160),
  crossStreets: text(3, 120),
  notes: text(0, 300).default(""),
});

const baseFields = {
  idempotencyKey: z
    .string({ error: "Clave inválida" })
    .regex(UUID_V4, "Clave inválida")
    .transform((k) => k.toLowerCase()),
  units: z.array(unitSchema, { error: "El pedido está vacío" }).min(1, "El pedido está vacío").max(100, "El pedido es demasiado grande"),
  customer: customerSchema,
  paymentMethod: z.enum(["cash", "transfer"], { error: "Elegí un medio de pago" }),
  /** Honeypot: must be empty. */
  bh_ref: z.string({ error: BAD_TEXT }).max(500, BAD_TEXT).optional().default(""),
};

// Discriminated on `fulfillment` so that ALL field errors of the chosen branch are reported together.
export const createOrderSchema = z.discriminatedUnion("fulfillment", [
  z.object({
    ...baseFields,
    fulfillment: z.literal("delivery"),
    // A missing / non-object `delivery` is validated as {} so each field reports its own error.
    delivery: z.preprocess((v) => (typeof v === "object" && v !== null ? v : {}), deliverySchema),
  }),
  z.object({
    ...baseFields,
    fulfillment: z.literal("takeaway"),
    // Whatever was sent is discarded: takeaway orders never store an address.
    delivery: z.unknown().optional().transform(() => undefined),
  }),
], { error: "Elegí cómo recibir el pedido" });

export type CreateOrderInput = z.output<typeof createOrderSchema>;

/** First message per dotted path (`customer.name`, `delivery.address`, ...). */
export function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}
