import { Suspense } from "react";
import { getDb } from "@/db/client";
import { KitchenBoard } from "@/components/cocina/kitchen-board";
import { StaffShell, StaffShellFallback } from "@/components/staff/staff-shell";
import { ToastProvider } from "@/components/ui/toast";
import { requireSessionOrRedirect } from "@/lib/auth/guards";
import { toKitchenCardDto } from "@/lib/cocina/card-style";
import { kitchenThresholds } from "@/lib/orders/kitchen-age";
import { listKitchenBoard, listRecentlyReady } from "@/lib/orders/kitchen-queries";
import { actorRefusal, kitchenActorSectorFor } from "@/lib/orders/sector";
import { getSettings } from "@/lib/settings";

export const metadata = { title: "Cocina · The Burger House 828" };

async function CocinaPage() {
  const session = await requireSessionOrRedirect(["cocina", "cajera", "encargada_delivery", "admin"], "/cocina");
  const db = getDb();
  const now = new Date();
  const [board, recent, settings] = await Promise.all([listKitchenBoard(db), listRecentlyReady(db), getSettings(db)]);
  const actor = kitchenActorSectorFor(session.user.role, session.stationKind);

  return (
    <StaffShell session={session}>
      <ToastProvider>
        <KitchenBoard
          cards={board.map(toKitchenCardDto)}
          recent={recent.map(toKitchenCardDto)}
          serverNow={now.toISOString()}
          thresholds={kitchenThresholds(settings)}
          ownsTitle={session.user.role === "cocina"}
          actorSector={actor.ok ? actor.sector : null}
          blockedReason={actor.ok ? null : actorRefusal(actor.code).message}
        />
      </ToastProvider>
    </StaffShell>
  );
}

/** Dynamic (cookies + DB): everything runs inside Suspense; the guard runs in the page itself. */
export default function Page() {
  return (
    <Suspense fallback={<StaffShellFallback />}>
      <CocinaPage />
    </Suspense>
  );
}
