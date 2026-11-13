import { getDb } from "@/db/client";
import { StaffShell } from "@/components/staff/staff-shell";
import { EditorMenuProvider } from "@/components/orders/editor-menu";
import { SectorWorkspace } from "@/components/staff/sector-workspace";
import { ToastProvider } from "@/components/ui/toast";
import { isManager } from "@/lib/auth/roles";
import { requireWorkspace } from "@/lib/auth/workspace";
import { getMenu } from "@/lib/menu/queries";
import { parseTab } from "@/lib/caja/workspaces";
import { listFailedPrintJobs, listPendingApproval, listRecentProcessed } from "@/lib/orders/caja-queries";
import { getDispatchBoard } from "@/lib/orders/dispatch-queries";
import type { Sector } from "@/lib/orders/sector";

type Config = { sector: Sector; path: string; title: string };
const CONFIG: Record<"mostrador" | "delivery", Config> = {
  // Unified counter screen: app takeaway orders (approval + in flight) together with the counter sales.
  mostrador: { sector: "mostrador", path: "/mostrador/pedidos", title: "Mostrador" },
  delivery: { sector: "delivery", path: "/delivery", title: "Gestión Delivery" },
};

/**
 * Server half of the order workspaces (/mostrador/pedidos and /delivery): guards by station kind, reads ONLY the
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
  // The order editor picks products from the public menu (cached): edit / add buttons exist only in these workspaces.
  const [menu, pending, recent, board, failed] = await Promise.all([
    getMenu(),
    listPendingApproval(db, { now, ...scope }),
    // Recientes keeps the whole sector (the counter sector also holds the counter sales: reprint lives here).
    listRecentProcessed(db, { limit: 30, now, sector }),
    // Mostrador shows counter sales AND app takeaway orders (both channels of the sector); delivery only its web orders.
    getDispatchBoard(db, sector === "mostrador" ? { now, sector } : { now, ...scope }),
    session.stationId === null ? Promise.resolve([]) : listFailedPrintJobs(db, session.stationId, { sector: isManager(session.user.role) ? null : sector }),
  ]);

  return (
    <StaffShell session={session} ownsOrderAlert>
      <h1 className="sr-only">{title}</h1>
      <ToastProvider>
        <EditorMenuProvider menu={menu}>
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
        </EditorMenuProvider>
      </ToastProvider>
    </StaffShell>
  );
}
