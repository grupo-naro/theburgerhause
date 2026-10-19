import { getDb } from "@/db/client";
import { StaffShell } from "@/components/staff/staff-shell";
import { SectorWorkspace } from "@/components/staff/sector-workspace";
import { ToastProvider } from "@/components/ui/toast";
import { isManager } from "@/lib/auth/roles";
import { requireWorkspace } from "@/lib/auth/workspace";
import { parseTab } from "@/lib/caja/workspaces";
import { listFailedPrintJobs, listPendingApproval, listRecentProcessed } from "@/lib/orders/caja-queries";
import { getDispatchBoard } from "@/lib/orders/dispatch-queries";
import type { Sector } from "@/lib/orders/sector";

type Config = { sector: Sector; path: string; title: string };
const CONFIG: Record<"retiro" | "delivery", Config> = {
  retiro: { sector: "mostrador", path: "/retiro", title: "Retiro en local" },
  delivery: { sector: "delivery", path: "/delivery", title: "Gestión Delivery" },
};

/**
 * Server half of the order workspaces (/retiro and /delivery): guards by station kind, reads ONLY the
 * sector's web orders (sector filter in the queries), and hands them to the tabbed workspace.
 */
export async function SectorWorkspacePage({
  which,
  searchParams,
}: {
  which: keyof typeof CONFIG;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { sector, path, title } = CONFIG[which];
  const roles = sector === "delivery" ? (["encargada_delivery", "admin", "encargado"] as const) : (["cajera", "admin", "encargado"] as const);
  const { session } = await requireWorkspace(sector, [...roles], path);
  const sp = await searchParams;

  const db = getDb();
  const now = new Date();
  const scope = { sector, channel: "web" } as const;
  const [pending, recent, board, failed] = await Promise.all([
    listPendingApproval(db, { now, ...scope }),
    // Recientes keeps the whole sector (the counter sector also holds the counter sales: reprint lives here).
    listRecentProcessed(db, { limit: 30, now, sector }),
    getDispatchBoard(db, { now, ...scope }),
    session.stationId === null ? Promise.resolve([]) : listFailedPrintJobs(db, session.stationId, { sector: isManager(session.user.role) ? null : sector }),
  ]);

  return (
    <StaffShell session={session} ownsOrderAlert>
      <h1 className="sr-only">{title}</h1>
      <ToastProvider>
        <SectorWorkspace
          sector={sector}
          role={session.user.role}
          initialTab={parseTab(sector, sp.tab)}
          pending={pending}
          recent={recent}
          failed={failed}
          board={board}
          serverNow={now.toISOString()}
          hasStation={session.stationId !== null}
          title={title}
          path={path}
        />
      </ToastProvider>
    </StaffShell>
  );
}
