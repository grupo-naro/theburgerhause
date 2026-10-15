import { z } from "zod";
import { normalizeWhatsapp, WHATSAPP_MESSAGE } from "./whatsapp";

/**
 * `createOrder` input contract. Objects are NOT strict: unknown keys (a forged
 * `total`, `price`, `status`...) are silently STRIPPED so they can never reach
 * the order logic. Shared by the checkout form (client) and the server.
 */

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// C0/C1 controls, Unicode format chars (zero-width, bidi marks, BOM) and line/paragraph separators.
// Tab/newline/CR become a space first (see cleanText).
const CONTROL = /[\x00-\x1f\x7f-\x9f\p{Cf}\p{Zl}\p{Zp}]/gu;

/** Free text: whitespace controls -> space, other controls removed, then trimmed. */
export function cleanText(s: string): string {
  return s.replace(/[\t\n\r]+/g, " ").replace(CONTROL, "").trim();
}

const text = (min: number, max: number) =>
  z
    .string()
    .transform(cleanText)
    .pipe(z.string().min(min, min > 0 ? "Es demasiado corto" : undefined).max(max, "Es demasiado largo"));

const unitSchema = z.object({
  productId: z.number().int().positive(),
  modifierIds: z.array(z.number().int().positive()).max(30),
  note: text(0, 140),
});

const customerSchema = z.object({
  name: text(2, 80),
  whatsapp: z.string().transform((raw, ctx) => {
    const r = normalizeWhatsapp(raw);
    if (!r.ok) {
      ctx.issues.push({ code: "custom", message: WHATSAPP_MESSAGE, input: raw });
      return z.NEVER;
    }
    return r.digits;
  }),
});

const deliverySchema = z.object({
  address: text(5, 160),
  crossStreets: text(3, 120),
  notes: text(0, 300).default(""),
});

export const createOrderSchema = z
  .object({
    idempotencyKey: z.string().regex(UUID_V4, "Clave inválida"),
    units: z.array(unitSchema).min(1, "El pedido está vacío").max(100),
    customer: customerSchema,
    fulfillment: z.enum(["delivery", "takeaway"]),
    // Validated below, and only when fulfillment = delivery (ignored otherwise).
    delivery: z.unknown().optional(),
    paymentMethod: z.enum(["cash", "transfer"]),
    /** Honeypot: must be empty. */
    website: z.string().max(500).optional().default(""),
  })
  .transform((v, ctx) => {
    const { delivery: rawDelivery, ...rest } = v;
    if (v.fulfillment === "takeaway") return { ...rest, delivery: undefined };
    const parsed = deliverySchema.safeParse(rawDelivery ?? {});
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.issues.push({ code: "custom", message: issue.message, input: rawDelivery, path: ["delivery", ...issue.path] });
      }
      return z.NEVER;
    }
    return { ...rest, delivery: parsed.data };
  });

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
