import { Suspense } from "react";
import { StaffShellFallback } from "@/components/staff/staff-shell";
import { SectorWorkspacePage } from "@/components/staff/sector-workspace-page";

export const metadata = { title: "Gestión Delivery · The Burger House 828" };

/** Dynamic (cookies + DB): everything runs inside Suspense; the guards run in the page itself. */
export default function Page({ searchParams }: PageProps<"/delivery">) {
  return (
    <Suspense fallback={<StaffShellFallback />}>
      <SectorWorkspacePage which="delivery" searchParams={searchParams} />
    </Suspense>
  );
}
