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

/** The server message repeats every offender after its first sentence; the banner lists them itself. */
export function failureHeadline(message: string, hasDetails: boolean): string {
  if (!hasDetails) return message;
  const end = message.indexOf(". ");
  return end === -1 ? message : message.slice(0, end + 1);
}

/** "2 de 3 listos": ready orders of a tanda out of the ones that have not left yet. */
export function tandaProgress(ready: number, total: number): string {
  return `${ready} de ${total} listos`;
}

/** The tanda assignment button: an incomplete tanda asks to send the ready ones anyway (the explicit confirmation). */
export function tandaAssignLabel({ ready, total, cadetName, inFlight }: { ready: number; total: number; cadetName: string | null; inFlight: boolean }): string {
  if (inFlight) return "Asignando…";
  if (ready < total) return `Asignar igual ${ready === 1 ? "el 1 listo" : `los ${ready} listos`}`;
  return cadetName ? `Asignar tanda a ${cadetName}` : "Asignar tanda";
}

export type TandaCounts = { number: number; ready: number; total: number };

/**
 * confirmPartial may be sent only when the person SAW the incomplete state ("Asignar igual los N listos") on the
 * button they pressed: `seen` is what the button showed after its last commit. If the tanda became incomplete
 * after that (a live update added a not-ready order), the tap does not confirm; the server answers and the
 * refreshed button then asks explicitly.
 */
export function shouldConfirmPartial(current: TandaCounts, seen: TandaCounts | null): boolean {
  if (current.ready >= current.total) return false;
  return seen !== null && seen.number === current.number && seen.ready === current.ready && seen.total === current.total;
}
