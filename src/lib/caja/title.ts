export const BASE_TITLE = "Caja";
export const ALERT_TITLE = "¡Nuevo pedido!";

/** Browser tab title: `(N) Caja`, alternating with `(N) ¡Nuevo pedido!` while an alert is pending. */
export function buildTitle({ pending, alert }: { pending: number; alert: boolean }): string {
  const n = Number.isFinite(pending) ? Math.max(0, Math.floor(pending)) : 0;
  const text = alert ? ALERT_TITLE : BASE_TITLE;
  return n > 0 ? `(${n}) ${text}` : text;
}
