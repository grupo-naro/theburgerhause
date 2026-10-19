import { Suspense } from "react";
import { getDb } from "@/db/client";
import { requireSessionOrRedirect } from "@/lib/auth/guards";
import { isManager } from "@/lib/auth/roles";
import { WRONG_STATION_REASON } from "@/lib/auth/workspace";
import { stationAllowedForRole } from "@/lib/orders/sector";
import { listStations } from "@/lib/stations";
import { selectStation } from "./actions";

export const metadata = { title: "Elegir estación · The Burger House 828" };

async function StationPicker({ searchParams }: { searchParams: PageProps<"/estacion">["searchParams"] }) {
  const { next, motivo } = await searchParams;
  const nextPath = typeof next === "string" ? next : "";
  const session = await requireSessionOrRedirect(["admin", "cajera", "encargada_delivery", "encargado"], "/estacion");
  // One workspace per sector: staff only see the stations of their own kind (the action enforces it too).
  const stations = (await listStations(getDb())).filter((s) => stationAllowedForRole(session.user.role, s.kind));
  const manager = isManager(session.user.role);
  const own = session.user.role === "cajera" ? "de Mostrador" : "de Delivery";
  return (
    <>
      {motivo === WRONG_STATION_REASON && (
        <p role="alert" data-testid="wrong-station" className="rounded-xl border-2 border-state-error bg-red-50 px-4 py-3 text-base font-semibold text-ink">
          Esa pantalla es de otro sector. Elegí una estación {own} para trabajar ahí.
        </p>
      )}
      {stations.length === 0 && (
        <p role="alert" data-testid="no-stations" className="rounded-xl border-2 border-line bg-surface px-4 py-3 text-base font-semibold text-ink">
          {manager ? "Todavía no hay estaciones creadas. Se crean en Administración." : `No hay estaciones ${own}. Pedile al admin que cree una.`}
        </p>
      )}
      <form action={selectStation} className="flex w-full flex-col gap-3">
        <input type="hidden" name="next" value={nextPath} />
        {stations.map((s) => (
          <button
            key={s.id}
            type="submit"
            name="stationId"
            value={s.id}
            className="flex items-center justify-between rounded-full bg-cheddar-400 px-6 py-4 text-left font-display text-xl font-bold text-ink hover:bg-cheddar-600"
          >
            <span>{s.name}</span>
            <span className="text-sm font-medium text-ink-muted">{s.kind === "delivery" ? "Delivery" : "Mostrador"}</span>
          </button>
        ))}
      </form>
    </>
  );
}

export default function EstacionPage({ searchParams }: PageProps<"/estacion">) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-10">
      <h1 className="font-display text-3xl font-extrabold text-brand-600">¿Dónde estás trabajando?</h1>
      <Suspense fallback={<p>Cargando estaciones…</p>}>
        <StationPicker searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
