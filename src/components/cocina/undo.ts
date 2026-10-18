import { kitchenUndoAction } from "@/app/(staff)/cocina/actions";

type Router = { refresh: () => void };
type Toaster = { show: (t: { message: string; durationMs?: number }) => void };

/** A second tap while the first undo is still running is dropped (shared by the toast and the "Recién listos" strip). */
const inFlight = new Set<number>();

/**
 * Puts a ready order back in preparation. Never throws: the outcome is a toast (the core's own message when it is
 * refused, e.g. the pager was already called) and the board is refreshed either way.
 */
export async function runUndo(orderId: number, { router, toast }: { router: Router; toast: Toaster }): Promise<boolean> {
  if (inFlight.has(orderId)) return false;
  inFlight.add(orderId);
  try {
    const r = await kitchenUndoAction({ orderId });
    if (r.ok) toast.show({ message: `Pedido #${r.data.number} volvió a preparación`, durationMs: 4000 });
    else toast.show({ message: r.message, durationMs: 7000 });
    return r.ok;
  } catch {
    toast.show({ message: "No se pudo deshacer. Probá de nuevo.", durationMs: 7000 });
    return false;
  } finally {
    inFlight.delete(orderId);
    router.refresh();
  }
}
