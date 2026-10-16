import type { DispatchFailureDetail } from "@/lib/orders/dispatch";

export type AssignState = { enabled: boolean; reason: string | null };

/** Whether "Asignar" can fire, and the sentence explaining why not. */
export function canAssign(selection: ReadonlySet<number>, cadetId: number | null, inFlight: boolean): AssignState {
  if (inFlight) return { enabled: false, reason: "Asignando…" };
  if (selection.size === 0) return { enabled: false, reason: "Elegí al menos un pedido" };
  if (cadetId === null) return { enabled: false, reason: "Elegí un cadete" };
  return { enabled: true, reason: null };
}

/** One line per offending order of a refused batch: "#12: ya está en camino". */
export function formatAssignFailure(details: ReadonlyArray<DispatchFailureDetail> | undefined): string[] {
  return (details ?? []).map((d) => `#${d.orderNumber ?? d.orderId}: ${d.reason}`);
}
