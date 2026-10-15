export const WHATSAPP_MESSAGE = "Ingresá un número de WhatsApp válido (solo números, con característica)";

const MIN_DIGITS = 8;
const MAX_DIGITS = 15;

export type WhatsappResult = { ok: true; digits: string } | { ok: false };

/**
 * Strips every non-digit and accepts 8..15 digits (E.164 upper bound). Local prefixes
 * ("0", "15") are deliberately NOT rewritten: the cashier sees exactly what was typed.
 */
export function normalizeWhatsapp(raw: string): WhatsappResult {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) return { ok: false };
  return { ok: true, digits };
}

/** wa.me link to the STORE with a message prefilled for this order. Null when the store has no number. */
export function orderWhatsappLink(storeWhatsapp: string, orderNumber: number): string | null {
  const digits = storeWhatsapp.replace(/\D/g, "");
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(`Hola! Consulto por mi pedido #${orderNumber}`)}`;
}
