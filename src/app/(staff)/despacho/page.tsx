import { Suspense } from "react";
import { getDb } from "@/db/client";
import { DispatchBoard } from "@/components/despacho/dispatch-board";
import { StaffShell, StaffShellFallback } from "@/components/staff/staff-shell";
import { ToastProvider } from "@/components/ui/toast";
import { requireGeneralView } from "@/lib/auth/workspace";
import { getDispatchBoard } from "@/lib/orders/dispatch-queries";

export const metadata = { title: "Tablero general · The Burger House 828" };

async function DespachoPage() {
  // Read-all view, admin only: staff are sent to the workspace of their sector.
  const session = await requireGeneralView("despacho", "/despacho");

  const now = new Date();
  const board = await getDispatchBoard(getDb(), { now });

  return (
    <StaffShell session={session}>
      <h1 className="sr-only">Tablero general · Despacho</h1>
      <ToastProvider>
        <DispatchBoard board={board} role={session.user.role} serverNow={now.toISOString()} />
      </ToastProvider>
    </StaffShell>
  );
}

/** Dynamic (cookies + DB): everything runs inside Suspense; the guards run in the page itself. */
export default function Page() {
  return (
    <Suspense fallback={<StaffShellFallback />}>
      <DespachoPage />
    </Suspense>
  );
}
