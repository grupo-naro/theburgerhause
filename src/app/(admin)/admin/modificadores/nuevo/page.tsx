import { asc } from "drizzle-orm";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { requireSessionOrRedirect } from "@/lib/auth/guards";
import { ModifierForm } from "../_components/modifier-form";

export const metadata = { title: "Nuevo modificador · Administración" };

export default async function NewModifierPage({ searchParams }: PageProps<"/admin/modificadores/nuevo">) {
  const sp = await searchParams;
  await requireSessionOrRedirect(["admin", "encargado"], "/admin/modificadores/nuevo");
  const groups = await getDb()
    .select({ id: s.modifierGroups.id, name: s.modifierGroups.name })
    .from(s.modifierGroups)
    .orderBy(asc(s.modifierGroups.id));
  // Untrusted query param: only preselect when it matches an existing group.
  const raw = typeof sp.grupo === "string" && /^\d+$/.test(sp.grupo) ? Number(sp.grupo) : null;
  const groupId = groups.some((g) => g.id === raw) ? raw : null;
  return (
    <section className="flex flex-col gap-5">
      <h1 className="font-display text-3xl font-extrabold text-brand-600">Nuevo modificador</h1>
      <ModifierForm
        groups={groups}
        initial={{ groupId, name: "", kind: "add", priceArs: 0, kitchenLabel: "", active: true }}
      />
    </section>
  );
}
