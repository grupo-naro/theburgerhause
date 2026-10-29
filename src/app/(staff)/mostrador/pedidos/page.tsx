import { Suspense } from "react";
import { getDb } from "@/db/client";
import { DispatchBoard } from "@/components/despacho/dispatch-board";
import { EditorMenuProvider } from "@/components/orders/editor-menu";
import { StaffShell, StaffShellFallback } from "@/components/staff/staff-shell";
import { ToastProvider } from "@/components/ui/toast";
import { requireWorkspace } from "@/lib/auth/workspace";
import { getMenu } from "@/lib/menu/queries";
import { getDispatchBoard } from "@/lib/orders/dispatch-queries";

export const metadata = { title: "Mostrador · The Burger House 828" };

/** Counter sales in flight: in the kitchen, ready (call the pager), waiting at the counter. */
async function PedidosPage() {
  const { session, scope } = await requireWorkspace("mostrador", ["cajera", "admin", "encargado"], "/mostrador/pedidos");
  const now = new Date();
  // Counter orders can get add-ons while in preparation: the editor picks from the public menu (cached).
  const [menu, board] = await Promise.all([getMenu(), getDispatchBoard(getDb(), { now, sector: scope, channel: "counter" })]);

  return (
    <StaffShell session={session}>
      <h1 className="sr-only">Mostrador</h1>
      <ToastProvider>
        <EditorMenuProvider menu={menu}>
          <DispatchBoard board={board} role={session.user.role} serverNow={now.toISOString()} sector={scope} />
        </EditorMenuProvider>
      </ToastProvider>
    </StaffShell>
  );
}

/** Dynamic (cookies + DB): everything runs inside Suspense; the guards run in the page itself. */
export default function Page() {
  return (
    <Suspense fallback={<StaffShellFallback />}>
      <PedidosPage />
    </Suspense>
  );
}
