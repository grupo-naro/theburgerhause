import { MAX_REASON_LENGTH, MIN_REASON_LENGTH } from "@/lib/caja/reasons";

export const RETURN_QUICK_REASONS = ["No atendió", "Dirección incorrecta", "Rechazó el pedido", "Sin cambio"] as const;

export function isReturnReasonValid(text: string): boolean {
  const n = text.trim().length;
  return n >= MIN_REASON_LENGTH && n <= MAX_REASON_LENGTH;
}
