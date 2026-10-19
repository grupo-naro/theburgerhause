import { Suspense } from "react";
import { getDb } from "@/db/client";
import { CartProvider } from "@/components/cart/cart-provider";
import { MenuProvider } from "@/components/menu/menu-provider";
import { NoStation } from "@/components/pos/no-station";
import { PosBoard } from "@/components/pos/pos-board";
import { StaffShell, StaffShellFallback } from "@/components/staff/staff-shell";
import { ToastProvider } from "@/components/ui/toast";
import { requireWorkspace } from "@/lib/auth/workspace";
import { getMenu } from "@/lib/menu/queries";
import { listActivePagers } from "@/lib/orders/pagers";
import { posCartStorageKey } from "@/lib/pos/storage-key";

export const metadata = { title: "Venta · The Burger House 828" };

async function MostradorPage() {
  const { session } = await requireWorkspace("mostrador", ["cajera", "admin", "encargado"], "/mostrador");

  // Counter sales ignore the web "closed" switch; prices/products are the PUBLIC (active) menu.
  const [menu, pagers] = await Promise.all([getMenu(), listActivePagers(getDb())]);
  const storageKey = posCartStorageKey(session.stationId);

  return (
    <StaffShell session={session}>
      <h1 className="sr-only">Venta</h1>
      {session.stationId === null ? (
        <NoStation />
      ) : (
        <ToastProvider>
          <MenuProvider menu={menu}>
            <CartProvider key={storageKey} storageKey={storageKey}>
              <PosBoard initialPagers={pagers} stationId={session.stationId} />
            </CartProvider>
          </MenuProvider>
        </ToastProvider>
      )}
    </StaffShell>
  );
}

/** Dynamic (cookies + DB): everything runs inside Suspense; the guards run in the page itself. */
export default function Page() {
  return (
    <Suspense fallback={<StaffShellFallback />}>
      <MostradorPage />
    </Suspense>
  );
}
