import { Suspense } from "react";
import { requireSessionOrRedirect, requireStationOrRedirect } from "@/lib/auth/guards";
import type { Role } from "@/lib/auth/roles";
import { StaffShell, StaffShellFallback } from "@/components/staff/staff-shell";

type Props = { title: string; path: string; roles: Role[]; needsStation?: boolean };

async function PlaceholderPage({ title, path, roles, needsStation = false }: Props) {
  const session = await requireSessionOrRedirect(roles, path);
  if (needsStation && session.user.role !== "admin") requireStationOrRedirect(session, path);
  return (
    <StaffShell session={session}>
      <h1 className="font-display text-3xl font-extrabold text-brand-600">{title}</h1>
      <p className="mt-2 text-lg text-ink-muted">Esta pantalla todavía no está disponible.</p>
    </StaffShell>
  );
}

/**
 * Temporary protected page body (Mostrador / Despacho) inside the real staff shell, which owns the
 * page's single live connection. Replaced by the real screens in later sprints.
 */
export function StaffPlaceholder(props: Props) {
  return (
    <Suspense fallback={<StaffShellFallback />}>
      <PlaceholderPage {...props} />
    </Suspense>
  );
}
