import { Suspense } from "react";
import { getDb } from "@/db/client";
import { CounterBoard } from "@/components/pantalla/counter-board";
import { requireSessionOrRedirect } from "@/lib/auth/guards";
import { getCounterBoard } from "@/lib/orders/counter-board";

export const metadata = { title: "Pantalla · The Burger House 828" };

/**
 * The counter TV: order numbers "En preparación" / "¡Listo! Retiralo en el mostrador". Fullscreen and read only, the
 * same for every role that opens it (no sidebar, navigation, station or user name). The `cocina` user is the TV's
 * login (long session); cajera, encargada, encargado and admin can open it too.
 */
async function PantallaPage() {
  await requireSessionOrRedirect(["cocina", "cajera", "encargada_delivery", "encargado", "admin"], "/pantalla");
  const board = await getCounterBoard(getDb());
  return (
    <CounterBoard
      preparing={board.preparing.map((o) => ({ id: o.id, number: o.number }))}
      ready={board.ready.map((o) => ({ id: o.id, number: o.number }))}
    />
  );
}

/** Dynamic (cookies + DB): everything runs inside Suspense; the guard runs in the page itself. */
export default function Page() {
  return (
    <Suspense fallback={<div className="fixed inset-0 bg-[#0b1220]" aria-busy="true" />}>
      <PantallaPage />
    </Suspense>
  );
}
