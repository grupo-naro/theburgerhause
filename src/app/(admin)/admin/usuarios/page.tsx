import Link from "next/link";
import { ActionButton } from "@/components/ui/action-button";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getDb } from "@/db/client";
import { requireSessionOrRedirect } from "@/lib/auth/guards";
import { listUsers } from "@/lib/users/admin";
import { revokeSessionsAction, toggleUserActiveAction } from "./actions";
import { ROLE_LABEL } from "./_components/role-label";

export const metadata = { title: "Usuarios · Administración" };

const th = "p-3 font-semibold";

export default async function AdminUsersPage() {
  const session = await requireSessionOrRedirect(["admin"], "/admin/usuarios");
  const users = await listUsers(getDb());
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-extrabold text-brand-600">Usuarios</h1>
        <Link href="/admin/usuarios/nuevo" className={buttonClass("primary")}>
          Nuevo usuario
        </Link>
      </div>
      <p className="text-sm text-ink-muted">
        Los usuarios no se borran: se desactivan, y eso cierra sus sesiones al instante. Siempre tiene que quedar un
        administrador activo.
      </p>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Usuarios</caption>
          <thead className="text-xs text-ink-muted uppercase">
            <tr>
              <th scope="col" className={th}>
                Nombre
              </th>
              <th scope="col" className={`${th} hidden md:table-cell`}>
                Usuario
              </th>
              <th scope="col" className={`${th} hidden md:table-cell`}>
                Rol
              </th>
              <th scope="col" className={`${th} hidden md:table-cell`}>
                Sesiones
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
            {users.map((u) => {
              const self = u.id === session.user.id;
              return (
                <tr key={u.id} className={u.active ? "" : "bg-slate-50 text-ink-muted"}>
                  <td className="p-3 font-medium">
                    {u.name}
                    {self ? <span className="ml-2 text-xs font-normal text-ink-muted">(vos)</span> : null}
                    <span className="block text-xs font-normal text-ink-muted md:hidden">
                      {u.username} · {ROLE_LABEL[u.role]} · {u.activeSessions} sesiones
                    </span>
                  </td>
                  <td className="hidden p-3 font-mono text-xs md:table-cell">{u.username}</td>
                  <td className="hidden p-3 md:table-cell">{ROLE_LABEL[u.role]}</td>
                  <td className="hidden p-3 md:table-cell">{u.activeSessions}</td>
                  <td className="p-3">
                    <Badge tone={u.active ? "success" : "muted"}>{u.active ? "Activo" : "Inactivo"}</Badge>
                  </td>
                  <td className="p-3">
                    <div className="flex flex-wrap items-start gap-1">
                      <ActionButton
                        action={toggleUserActiveAction}
                        fields={{ id: u.id, value: String(!u.active) }}
                        label={`${u.active ? "Desactivar" : "Activar"} ${u.username}`}
                      >
                        {u.active ? "Desactivar" : "Activar"}
                      </ActionButton>
                      <ActionButton
                        action={revokeSessionsAction}
                        fields={{ id: u.id }}
                        label={`Cerrar sesiones de ${u.username}`}
                        disabled={u.activeSessions === 0}
                      >
                        Cerrar sesiones
                      </ActionButton>
                      <Link href={`/admin/usuarios/${u.id}`} className={buttonClass("ghost", "sm")}>
                        Editar
                      </Link>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </section>
  );
}
