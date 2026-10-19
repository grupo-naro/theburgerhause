import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { requireSessionOrRedirect } from "@/lib/auth/guards";
import { getGroupForAdmin } from "@/lib/modifiers/admin";
import { GroupForm } from "../../_components/group-form";

export const metadata = { title: "Editar grupo · Administración" };

export default async function EditGroupPage({ params }: PageProps<"/admin/modificadores/grupos/[id]">) {
  const { id: rawId } = await params;
  const id = /^\d+$/.test(rawId) ? Number(rawId) : NaN;
  await requireSessionOrRedirect(["admin", "encargado"], `/admin/modificadores/grupos/${encodeURIComponent(rawId)}`);
  const group = Number.isSafeInteger(id) ? await getGroupForAdmin(getDb(), id) : null;
  if (!group) notFound();
  return (
    <section className="flex flex-col gap-5">
      <h1 className="font-display text-3xl font-extrabold text-brand-600">Editar grupo</h1>
      <GroupForm key={group.id} initial={{ id: group.id, name: group.name }} />
    </section>
  );
}
