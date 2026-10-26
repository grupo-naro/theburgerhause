import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireSessionOrRedirect } from "@/lib/auth/guards";

export const metadata = { title: "Cocina · The Burger House 828" };

/**
 * The old kitchen screen is gone: the counter TV lives at /pantalla and kitchen gets its ticket on the printer.
 * Old bookmarks and the TV browsers that still open /cocina land on /pantalla; no session goes to /login like always.
 * Temporary redirect on purpose: a cached permanent one could outlive the session check.
 */
async function CocinaRedirect(): Promise<never> {
  await requireSessionOrRedirect(["cocina", "cajera", "encargada_delivery", "encargado", "admin"], "/pantalla");
  redirect("/pantalla");
}

/** Dynamic (cookies): runs inside Suspense, like every staff page. */
export default function Page() {
  return (
    <Suspense fallback={<div className="fixed inset-0 bg-[#0b1220]" aria-busy="true" />}>
      <CocinaRedirect />
    </Suspense>
  );
}
