import { getDb } from "@/db/client";
import { requireSessionOrRedirect } from "@/lib/auth/guards";
import { listStationsForAdmin } from "@/lib/stations/admin";
import { CreateStationForm } from "./_components/create-station-form";
import { StationCard } from "./_components/station-card";

export const metadata = { title: "Estaciones · Administración" };

const lastSeenFormat = new Intl.DateTimeFormat("es-AR", {
  timeZone: "America/Argentina/Buenos_Aires",
  dateStyle: "short",
  timeStyle: "short",
});

export default async function AdminStationsPage() {
  await requireSessionOrRedirect(["admin"], "/admin/estaciones");
  const stations = await listStationsForAdmin(getDb());
  return (
    <section className="flex flex-col gap-5">
      <h1 className="font-display text-3xl font-extrabold text-brand-600">Estaciones</h1>
      <p className="text-sm text-ink-muted">
        Cada estación imprime con su propio Print Agent, que se identifica con un token. El token se muestra una sola
        vez al crearlo o rotarlo; en la base solo queda su huella. Las estaciones no se eliminan.
      </p>
      <CreateStationForm />
      {stations.length === 0 ? (
        <p className="text-ink-muted">Todavía no hay estaciones.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {stations.map((st) => (
            <StationCard
              key={st.id}
              station={{
                id: st.id,
                name: st.name,
                kind: st.kind,
                hasToken: st.hasToken,
                connection: st.connection,
                lastSeenLabel: st.lastSeenAt ? lastSeenFormat.format(st.lastSeenAt) : null,
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}
