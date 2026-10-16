export const BASE_TITLE = "Caja";
export const ALERT_TITLE = "¡Nuevo pedido!";

/** Browser tab title: `(N) Caja`, alternating with `(N) ¡Nuevo pedido!` while an alert is pending. */
export function buildTitle({ pending, alert, base = BASE_TITLE }: { pending: number; alert: boolean; base?: string }): string {
  const n = Number.isFinite(pending) ? Math.max(0, Math.floor(pending)) : 0;
  const text = alert ? ALERT_TITLE : base;
  return n > 0 ? `(${n}) ${text}` : text;
}
