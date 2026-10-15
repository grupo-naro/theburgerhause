import { Suspense } from "react";
import { getDb } from "@/db/client";
import { CajaBoard } from "@/components/caja/caja-board";
import { StaffShell, StaffShellFallback } from "@/components/staff/staff-shell";
import { requireSessionOrRedirect, requireStationOrRedirect } from "@/lib/auth/guards";
import { listFailedPrintJobs, listPendingApproval, listRecentProcessed } from "@/lib/orders/caja-queries";

export const metadata = { title: "Caja · The Burger House 828" };

async function CajaPage() {
  const session = await requireSessionOrRedirect(["cajera", "encargada_delivery", "admin"], "/caja");
  if (session.user.role !== "admin") requireStationOrRedirect(session, "/caja");

  const db = getDb();
  const now = new Date();
  const [pending, recent, failed] = await Promise.all([
    listPendingApproval(db, { now }),
    listRecentProcessed(db, { limit: 30, now }),
    session.stationId === null ? Promise.resolve([]) : listFailedPrintJobs(db, session.stationId),
  ]);

  return (
    <StaffShell session={session}>
      <h1 className="sr-only">Caja</h1>
      <CajaBoard
        pending={pending}
        recent={recent}
        failed={failed}
        serverNow={now.toISOString()}
        hasStation={session.stationId !== null}
      />
    </StaffShell>
  );
}

/** Dynamic (cookies + DB): everything runs inside Suspense; the guards run in the page itself. */
export default function Page() {
  return (
    <Suspense fallback={<StaffShellFallback />}>
      <CajaPage />
    </Suspense>
  );
}
