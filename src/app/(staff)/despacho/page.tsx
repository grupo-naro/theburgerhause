import { Suspense } from "react";
import { getDb } from "@/db/client";
import { DispatchBoard } from "@/components/despacho/dispatch-board";
import { StaffShell, StaffShellFallback } from "@/components/staff/staff-shell";
import { ToastProvider } from "@/components/ui/toast";
import { requireSessionOrRedirect, requireStationOrRedirect } from "@/lib/auth/guards";
import { getDispatchBoard } from "@/lib/orders/dispatch-queries";

export const metadata = { title: "Despacho · The Burger House 828" };

async function DespachoPage() {
  const session = await requireSessionOrRedirect(["encargada_delivery", "cajera", "admin"], "/despacho");
  if (session.user.role !== "admin") requireStationOrRedirect(session, "/despacho");

  const now = new Date();
  const board = await getDispatchBoard(getDb(), { now });

  return (
    <StaffShell session={session}>
      <h1 className="sr-only">Despacho</h1>
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
