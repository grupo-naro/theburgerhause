import Link from "next/link";
import { ActionButton } from "@/components/ui/action-button";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getDb } from "@/db/client";
import { requireSessionOrRedirect } from "@/lib/auth/guards";
import { listCadets } from "@/lib/cadets/admin";
import { toggleCadetActiveAction } from "./actions";

export const metadata = { title: "Cadetes · Administración" };

const th = "p-3 font-semibold";

export default async function AdminCadetsPage() {
  await requireSessionOrRedirect(["admin"], "/admin/cadetes");
  const cadets = await listCadets(getDb());
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-extrabold text-brand-600">Cadetes</h1>
        <Link href="/admin/cadetes/nuevo" className={buttonClass("primary")}>
          Nuevo cadete
        </Link>
      </div>
      <p className="text-sm text-ink-muted">
        Los cadetes inactivos no aparecen al despachar. No se pueden desactivar con pedidos en camino.
      </p>
      {cadets.length === 0 ? (
        <Card>
          <p className="text-ink-muted">Todavía no hay cadetes. Cargá el primero para poder despachar pedidos.</p>
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Cadetes</caption>
            <thead className="text-xs text-ink-muted uppercase">
              <tr>
                <th scope="col" className={th}>
                  Nombre
                </th>
                <th scope="col" className={`${th} hidden sm:table-cell`}>
                  Teléfono
                </th>
                <th scope="col" className={`${th} hidden sm:table-cell`}>
                  En camino
                </th>
                <th scope="col" className={th}>
                  Estado
                </th>
                <th scope="col" className={th}>
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {cadets.map((c) => (
                <tr key={c.id} className={c.active ? "" : "bg-slate-50 text-ink-muted"}>
                  <td className="p-3 font-medium">
                    {c.name}
                    <span className="block text-xs font-normal text-ink-muted sm:hidden">
                      {c.phone ?? "Sin teléfono"} · {c.enCamino} en camino
                    </span>
                  </td>
                  <td className="hidden p-3 whitespace-nowrap sm:table-cell">{c.phone ?? "–"}</td>
                  <td className="hidden p-3 sm:table-cell">{c.enCamino}</td>
                  <td className="p-3">
                    <Badge tone={c.active ? "success" : "muted"}>{c.active ? "Activo" : "Inactivo"}</Badge>
                  </td>
                  <td className="p-3">
                    <div className="flex flex-wrap items-start gap-1">
                      <ActionButton
                        action={toggleCadetActiveAction}
                        fields={{ id: c.id, value: String(!c.active) }}
                        label={`${c.active ? "Desactivar" : "Activar"} ${c.name}`}
                      >
                        {c.active ? "Desactivar" : "Activar"}
                      </ActionButton>
                      <Link href={`/admin/cadetes/${c.id}`} className={buttonClass("ghost", "sm")}>
                        Editar
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </section>
  );
}
