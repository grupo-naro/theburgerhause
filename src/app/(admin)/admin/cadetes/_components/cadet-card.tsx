import Link from "next/link";
import { ActionButton } from "@/components/ui/action-button";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import type { listCadets } from "@/lib/cadets/admin";
import { toggleCadetActiveAction } from "../actions";

type AdminCadet = Awaited<ReturnType<typeof listCadets>>[number];

/** Phone layout of one cadet (the md+ layout is the table row). */
export function CadetCard({ cadet: c }: { cadet: AdminCadet }) {
  return (
    <li
      className={`flex flex-col gap-3 rounded-2xl border border-line p-3 ${c.active ? "bg-surface" : "bg-slate-50 text-ink-muted"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium [overflow-wrap:anywhere]">{c.name}</p>
          <p className="text-sm text-ink-muted">
            {c.phone ?? "Sin teléfono"} · {c.enCamino} en camino
          </p>
        </div>
        <Badge tone={c.active ? "success" : "muted"}>{c.active ? "Activo" : "Inactivo"}</Badge>
      </div>
      <div className="flex items-start gap-2">
        <ActionButton
          action={toggleCadetActiveAction}
          fields={{ id: c.id, value: String(!c.active) }}
          label={`${c.active ? "Desactivar" : "Activar"} ${c.name}`}
          size="md"
          className="flex-1"
        >
          {c.active ? "Desactivar" : "Activar"}
        </ActionButton>
        <Link href={`/admin/cadetes/${c.id}`} className={`${buttonClass("secondary", "md")} flex-1`}>
          Editar
        </Link>
      </div>
    </li>
  );
}
