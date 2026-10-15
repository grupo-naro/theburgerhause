import type { ReactNode } from "react";
import { LogoutButton } from "@/components/logout-button";
import { requireSessionOrRedirect } from "@/lib/auth/guards";
import { AdminNav } from "./admin-nav";

/** Reads the session (request-time data): render it inside <Suspense>. */
export async function AdminShell({ children }: { children: ReactNode }) {
  const session = await requireSessionOrRedirect(["admin"], "/admin");
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3">
        <span className="font-display text-xl font-extrabold text-brand-600">Administración</span>
        <div className="flex items-center gap-3">
          <span className="text-sm text-ink-muted">{session.user.name}</span>
          <LogoutButton />
        </div>
      </header>
      <div className="flex flex-1 flex-col md:flex-row">
        <AdminNav />
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
      </div>
    </div>
  );
}
