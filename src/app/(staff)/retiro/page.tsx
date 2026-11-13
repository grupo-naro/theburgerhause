import { redirect } from "next/navigation";
import { Suspense } from "react";
import { StaffShellFallback } from "@/components/staff/staff-shell";
import { requireSessionOrRedirect } from "@/lib/auth/guards";

const TARGET = "/mostrador/pedidos";

/** Legacy URL: app takeaway orders are handled on the unified Mostrador screen now (guarded there too). */
async function LegacyRetiro(): Promise<never> {
  await requireSessionOrRedirect(["cajera", "admin", "encargado"], TARGET);
  redirect(TARGET);
}

export default function Page() {
  return (
    <Suspense fallback={<StaffShellFallback />}>
      <LegacyRetiro />
    </Suspense>
  );
}
