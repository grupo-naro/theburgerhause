import { asc } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { centsToPesos } from "@/domain/money";
import { requireSessionOrRedirect } from "@/lib/auth/guards";
import { getModifierForAdmin } from "@/lib/modifiers/admin";
import { normalizeKitchenLabel } from "@/lib/modifiers/kitchen-label";
import { ModifierForm } from "../_components/modifier-form";

export const metadata = { title: "Editar modificador · Administración" };

export default async function EditModifierPage({ params }: PageProps<"/admin/modificadores/[id]">) {
  const { id: rawId } = await params;
  const id = /^\d+$/.test(rawId) ? Number(rawId) : NaN;
  await requireSessionOrRedirect(["admin", "encargado"], `/admin/modificadores/${encodeURIComponent(rawId)}`);
  const db = getDb();
  const modifier = Number.isSafeInteger(id) ? await getModifierForAdmin(db, id) : null;
  if (!modifier) notFound();
  const groups = await db
    .select({ id: s.modifierGroups.id, name: s.modifierGroups.name })
    .from(s.modifierGroups)
    .orderBy(asc(s.modifierGroups.id));
  // A label equal to the derived one is shown as "auto" (blank) so renaming keeps it in sync.
  const derived = normalizeKitchenLabel(modifier.name, modifier.kind);
  return (
    <section className="flex flex-col gap-5">
      <h1 className="font-display text-3xl font-extrabold text-brand-600">Editar modificador</h1>
      <ModifierForm
        key={modifier.id}
        groups={groups}
        initial={{
          id: modifier.id,
          groupId: modifier.groupId,
          name: modifier.name,
          kind: modifier.kind,
          priceArs: centsToPesos(modifier.priceDelta),
          kitchenLabel: modifier.kitchenLabel === derived ? "" : modifier.kitchenLabel,
          active: modifier.active,
        }}
      />
    </section>
  );
}
