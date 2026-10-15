export const MIN_REASON_LENGTH = 3;
/** Same ceiling as the server (`rejectReasonSchema`). */
export const MAX_REASON_LENGTH = 200;

export const QUICK_REASONS = ["Sin stock", "Zona sin cobertura", "Pago no acreditado", "Datos incompletos"] as const;

export function isReasonValid(text: string): boolean {
  const n = text.trim().length;
  return n >= MIN_REASON_LENGTH && n <= MAX_REASON_LENGTH;
}

/** A quick-reason chip replaces whatever was typed. */
export function applyQuickReason(_current: string, quick: string): string {
  return quick;
}
