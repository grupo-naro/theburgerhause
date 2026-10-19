import Link from "next/link";
import { ActionButton } from "@/components/ui/action-button";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { OverflowMenu } from "@/components/ui/overflow-menu";
import type { listUsers } from "@/lib/users/admin";
import { revokeSessionsAction, toggleUserActiveAction } from "../actions";
import { ROLE_LABEL } from "./role-label";

type AdminUser = Awaited<ReturnType<typeof listUsers>>[number];

/** Phone layout of one user (the md+ layout is the table row). */
export function UserCard({ user: u, self }: { user: AdminUser; self: boolean }) {
  return (
    <li
      className={`flex flex-col gap-3 rounded-2xl border border-line p-3 ${u.active ? "bg-surface" : "bg-slate-50 text-ink-muted"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium [overflow-wrap:anywhere]">
            {u.name}
            {self ? <span className="ml-2 text-xs font-normal text-ink-muted">(vos)</span> : null}
          </p>
          <p className="text-sm text-ink-muted [overflow-wrap:anywhere]">
            {u.username} · {ROLE_LABEL[u.role]} · {u.activeSessions} sesiones
          </p>
        </div>
        <Badge tone={u.active ? "success" : "muted"}>{u.active ? "Activo" : "Inactivo"}</Badge>
      </div>
      <div className="flex items-start gap-2">
        <ActionButton
          action={toggleUserActiveAction}
          fields={{ id: u.id, value: String(!u.active) }}
          label={`${u.active ? "Desactivar" : "Activar"} ${u.username}`}
          size="md"
          className="flex-1"
        >
          {u.active ? "Desactivar" : "Activar"}
        </ActionButton>
        <Link href={`/admin/usuarios/${u.id}`} className={`${buttonClass("secondary", "md")} flex-1`}>
          Editar
        </Link>
        <OverflowMenu label={`Más acciones de ${u.username}`}>
          <ActionButton
            action={revokeSessionsAction}
            fields={{ id: u.id }}
            label={`Cerrar sesiones de ${u.username}`}
            disabled={u.activeSessions === 0}
          >
            Cerrar sesiones
          </ActionButton>
        </OverflowMenu>
      </div>
    </li>
  );
}
