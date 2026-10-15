import { Suspense } from "react";
import { getDb } from "@/db/client";
import { requireSessionOrRedirect, requireStationOrRedirect } from "@/lib/auth/guards";
import type { Role } from "@/lib/auth/roles";
import { findStation } from "@/lib/stations";
import { LogoutButton } from "@/components/logout-button";

async function Greeting({ roles, path, needsStation }: { roles: Role[]; path: string; needsStation: boolean }) {
  const session = await requireSessionOrRedirect(roles, path);
  if (needsStation && session.user.role !== "admin") requireStationOrRedirect(session, path);
  const station = session.stationId === null ? null : await findStation(getDb(), session.stationId);
  return (
    <>
      <p className="text-lg">
        Hola, {session.user.name} — {station?.name ?? "sin estación"}
      </p>
      <LogoutButton />
    </>
  );
}

/** Temporary protected page body; replaced by the real screens in later sprints. */
export function StaffPlaceholder({
  title,
  path,
  roles,
  needsStation = false,
}: {
  title: string;
  path: string;
  roles: Role[];
  needsStation?: boolean;
}) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-col items-start gap-4 px-4 py-10">
      <h1 className="font-display text-3xl font-extrabold text-brand-600">{title}</h1>
      <Suspense fallback={<p>Cargando…</p>}>
        <Greeting roles={roles} path={path} needsStation={needsStation} />
      </Suspense>
    </main>
  );
}
