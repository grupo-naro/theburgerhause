import { Suspense } from "react";
import { StaffShellFallback } from "@/components/staff/staff-shell";
import { SectorWorkspacePage } from "@/components/staff/sector-workspace-page";

export const metadata = { title: "Mostrador · The Burger House 828" };

/**
 * Unified counter screen: app takeaway orders to approve, then every non-delivery order in flight (counter
 * sales and app takeaway), then Recientes. Dynamic (cookies + DB): everything runs inside Suspense.
 */
export default function Page({ searchParams }: PageProps<"/mostrador/pedidos">) {
  return (
    <Suspense fallback={<StaffShellFallback />}>
      <SectorWorkspacePage which="mostrador" searchParams={searchParams} />
    </Suspense>
  );
}
