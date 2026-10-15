import { Suspense } from "react";
import { AdminShell } from "./admin-shell";

export const metadata = { title: "Administración · The Burger House 828" };

/**
 * The layout only guards the first render (layouts don't re-run on client
 * navigation): every page/action that touches data authorizes on its own.
 */
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <Suspense fallback={<p className="p-6 text-ink-muted">Cargando…</p>}>
      <AdminShell>{children}</AdminShell>
    </Suspense>
  );
}
