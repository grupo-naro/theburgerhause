import Link from "next/link";
import { ActionButton } from "@/components/ui/action-button";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { OverflowMenu } from "@/components/ui/overflow-menu";
import { formatARS } from "@/domain/money";
import type { AdminModifierGroup } from "@/lib/modifiers/admin";
import { moveModifierAction, toggleModifierActiveAction } from "../actions";
import { KIND_LABEL } from "./kind-label";

type Modifier = AdminModifierGroup["modifiers"][number];

/** Phone layout of one modifier option (the md+ layout is the table row). */
export function OptionCard({ modifier: m, first, last }: { modifier: Modifier; first: boolean; last: boolean }) {
  return (
    <li
      className={`flex flex-col gap-3 rounded-2xl border border-line p-3 ${m.active ? "bg-surface" : "bg-slate-50 text-ink-muted"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium [overflow-wrap:anywhere]">{m.name}</p>
          <p className="text-sm text-ink-muted">
            {KIND_LABEL[m.kind]}
            {m.kind === "remove" ? "" : ` · ${formatARS(m.priceDelta)}`}
          </p>
          <code className="mt-1 inline-block max-w-full rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs font-bold [overflow-wrap:anywhere]">
            {m.kitchenLabel}
          </code>
        </div>
        <Badge tone={m.active ? "success" : "muted"}>{m.active ? "Activo" : "Inactivo"}</Badge>
      </div>
      <div className="flex items-start gap-2">
        <ActionButton
          action={toggleModifierActiveAction}
          fields={{ id: m.id, value: String(!m.active) }}
          label={`${m.active ? "Desactivar" : "Activar"} ${m.name}`}
          size="md"
          className="flex-1"
        >
          {m.active ? "Desactivar" : "Activar"}
        </ActionButton>
        <Link href={`/admin/modificadores/${m.id}`} className={`${buttonClass("secondary", "md")} flex-1`}>
          Editar
        </Link>
        <OverflowMenu label={`Más acciones de ${m.name}`}>
          <ActionButton
            action={moveModifierAction}
            fields={{ id: m.id, dir: "up" }}
            label={`Subir ${m.name}`}
            disabled={first}
          >
            Subir
          </ActionButton>
          <ActionButton
            action={moveModifierAction}
            fields={{ id: m.id, dir: "down" }}
            label={`Bajar ${m.name}`}
            disabled={last}
          >
            Bajar
          </ActionButton>
        </OverflowMenu>
      </div>
    </li>
  );
}
