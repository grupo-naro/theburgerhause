import { MIN_SHORTAGE_NOTE } from "@/lib/settlements/schemas";
import type { ParseResult } from "./parse-pesos";
import { OVER_MESSAGE } from "./shortage";

export type ConfirmState = {
  orderCount: number;
  /** Centavos the server will expect (the figure rendered). */
  expected: number;
  received: ParseResult;
  note: string;
  inFlight: boolean;
};

export type ConfirmCheck = { ok: true } | { ok: false; reason: string };

/** Single source of truth for "Confirmar rendición": enabled, or the reason it is not. */
export function canConfirm(s: ConfirmState): ConfirmCheck {
  if (s.inFlight) return { ok: false, reason: "Guardando la rendición…" };
  if (s.orderCount <= 0) return { ok: false, reason: "Este cadete no tiene efectivo pendiente de rendir" };
  if (!s.received.ok) {
    return { ok: false, reason: s.received.reason === "empty" ? "Ingresá el efectivo recibido" : "El efectivo recibido no es un monto válido" };
  }
  if (s.received.cents > s.expected) return { ok: false, reason: OVER_MESSAGE };
  if (s.received.cents < s.expected && s.note.trim().length < MIN_SHORTAGE_NOTE) {
    return { ok: false, reason: `Explicá el faltante en la nota (mínimo ${MIN_SHORTAGE_NOTE} letras)` };
  }
  return { ok: true };
}

/** The confirmation dialog must not stay open over a figure the manager no longer sees. */
export function shouldCloseConfirm(expectedAtOpen: number, expectedNow: number): boolean {
  return expectedAtOpen !== expectedNow;
}
