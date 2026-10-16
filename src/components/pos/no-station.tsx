import Link from "next/link";

/** Blocking message for an admin who has not picked a station: tickets would have no printer to go to. */
export function NoStation() {
  return (
    <div role="alert" data-testid="no-station" className="mx-auto max-w-lg rounded-2xl border-2 border-state-error bg-red-50 p-8 text-center">
      <h2 className="font-display text-2xl font-extrabold text-ink">Falta elegir la estación</h2>
      <p className="mt-2 text-lg text-ink-muted">Sin estación no sabemos en qué impresora imprimir los pedidos del mostrador.</p>
      <Link
        href="/estacion?next=/mostrador"
        className="mt-5 inline-flex min-h-14 items-center rounded-full bg-brand-600 px-8 font-display text-lg font-bold text-white hover:bg-brand-700"
      >
        Elegir estación
      </Link>
    </div>
  );
}
