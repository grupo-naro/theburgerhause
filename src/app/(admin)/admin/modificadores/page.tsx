import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getDb } from "@/db/client";
import { requireSessionOrRedirect } from "@/lib/auth/guards";
import { listGroupsWithModifiers } from "@/lib/modifiers/admin";
import { GroupCard } from "./_components/group-card";

export const metadata = { title: "Modificadores · Administración" };

export default async function AdminModifiersPage() {
  await requireSessionOrRedirect(["admin"], "/admin/modificadores");
  const groups = await listGroupsWithModifiers(getDb());
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-extrabold text-brand-600">Modificadores</h1>
        <div className="flex gap-2">
          <Link href="/admin/modificadores/grupos/nuevo" className={buttonClass("secondary")}>
            Nuevo grupo
          </Link>
          <Link href="/admin/modificadores/nuevo" className={buttonClass("primary")}>
            Nuevo modificador
          </Link>
        </div>
      </div>
      <p className="text-sm text-ink-muted">
        Los grupos se asignan a cada producto desde su ficha en Menú. En la ficha del cliente aparecen ordenados por
        creación del grupo.
      </p>
      {groups.length === 0 ? (
        <Card>
          <p className="text-ink-muted">Todavía no hay grupos. Creá el primero para empezar a cargar modificadores.</p>
        </Card>
      ) : (
        groups.map((g) => <GroupCard key={g.id} group={g} />)
      )}
    </section>
  );
}
