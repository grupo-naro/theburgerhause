import Link from "next/link";
import { ActionButton } from "@/components/ui/action-button";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatARS } from "@/domain/money";
import type { AdminModifierGroup } from "@/lib/modifiers/admin";
import { moveModifierAction, toggleModifierActiveAction } from "../actions";
import { KIND_LABEL } from "./kind-label";

const th = "pb-1 pr-3 font-semibold";

export function GroupCard({ group }: { group: AdminModifierGroup }) {
  const { modifiers } = group;
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-2xl font-extrabold">{group.name}</h2>
        <div className="ml-auto flex flex-wrap items-start gap-1">
          <Link href={`/admin/modificadores/grupos/${group.id}`} className={buttonClass("ghost", "sm")}>
            Editar grupo
          </Link>
          <Link href={`/admin/modificadores/nuevo?grupo=${group.id}`} className={buttonClass("primary", "sm")}>
            Nuevo modificador
          </Link>
        </div>
      </div>
      {modifiers.length === 0 ? (
        <p className="text-sm text-ink-muted">Este grupo todavía no tiene modificadores.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[66rem] table-fixed text-left text-sm">
            <caption className="sr-only">Modificadores de {group.name}</caption>
            <thead className="text-xs text-ink-muted uppercase">
              <tr>
                <th scope="col" className={th}>
                  Nombre
                </th>
                <th scope="col" className={`${th} w-24`}>
                  Tipo
                </th>
                <th scope="col" className={`${th} w-28`}>
                  Precio
                </th>
                <th scope="col" className={`${th} w-56`}>
                  Cocina
                </th>
                <th scope="col" className={`${th} w-24`}>
                  Estado
                </th>
                <th scope="col" className="pb-1 font-semibold w-[19rem]">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {modifiers.map((m, i) => (
                <tr key={m.id} className={m.active ? "" : "bg-slate-50 text-ink-muted"}>
                  <td className="py-2 pr-3 font-medium">{m.name}</td>
                  <td className="py-2 pr-3">{KIND_LABEL[m.kind]}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{m.kind === "remove" ? "–" : formatARS(m.priceDelta)}</td>
                  <td className="py-2 pr-3">
                    <code className="inline-block max-w-full truncate rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs font-bold align-middle">
                      {m.kitchenLabel}
                    </code>
                  </td>
                  <td className="py-2 pr-3">
                    <Badge tone={m.active ? "success" : "muted"}>{m.active ? "Activo" : "Inactivo"}</Badge>
                  </td>
                  <td className="py-2">
                    <div className="flex flex-wrap items-start gap-1">
                      <ActionButton
                        action={moveModifierAction}
                        fields={{ id: m.id, dir: "up" }}
                        label={`Subir ${m.name}`}
                        disabled={i === 0}
                      >
                        ↑
                      </ActionButton>
                      <ActionButton
                        action={moveModifierAction}
                        fields={{ id: m.id, dir: "down" }}
                        label={`Bajar ${m.name}`}
                        disabled={i === modifiers.length - 1}
                      >
                        ↓
                      </ActionButton>
                      <ActionButton
                        action={toggleModifierActiveAction}
                        fields={{ id: m.id, value: String(!m.active) }}
                        label={`${m.active ? "Desactivar" : "Activar"} ${m.name}`}
                      >
                        {m.active ? "Desactivar" : "Activar"}
                      </ActionButton>
                      <Link href={`/admin/modificadores/${m.id}`} className={buttonClass("ghost", "sm")}>
                        Editar
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
