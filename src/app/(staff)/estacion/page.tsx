import { Suspense } from "react";
import { getDb } from "@/db/client";
import { requireSessionOrRedirect } from "@/lib/auth/guards";
import { listStations } from "@/lib/stations";
import { selectStation } from "./actions";

export const metadata = { title: "Elegir estación · The Burger House 828" };

async function StationPicker({ searchParams }: { searchParams: PageProps<"/estacion">["searchParams"] }) {
  const { next } = await searchParams;
  const nextPath = typeof next === "string" ? next : "";
  await requireSessionOrRedirect(["admin", "cajera", "encargada_delivery"], "/estacion");
  const stations = await listStations(getDb());
  return (
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
