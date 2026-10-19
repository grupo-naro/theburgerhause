import type { ReactNode } from "react";
import { LogoutButton } from "@/components/logout-button";
import { requireSessionOrRedirect } from "@/lib/auth/guards";
import { AdminMobileBar } from "./admin-mobile-bar";
import { AdminNav } from "./admin-nav";

/** Where "Volver a operación" leads: the staff area an admin works in (the inverse of the staff nav's "Administración" link). */
const OPERATION_HOME = "/mostrador";

/** Reads the session (request-time data): render it inside <Suspense>. */
export async function AdminShell({ children }: { children: ReactNode }) {
  const session = await requireSessionOrRedirect(["admin", "encargado"], "/admin");
  return (
    <div data-admin-touch className="flex min-h-dvh flex-col">
      <AdminMobileBar userName={session.user.name} role={session.user.role} homeHref={OPERATION_HOME} />
      <header className="hidden items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3 md:flex">
        <span className="font-display text-lg font-extrabold text-brand-600 sm:text-xl">Administración</span>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-ink-muted sm:inline">{session.user.name}</span>
          <LogoutButton />
        </div>
      </header>
      <div className="flex flex-1 flex-col md:flex-row">
        <AdminNav role={session.user.role} />
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
      </div>
    </div>
  );
}
