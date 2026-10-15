import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { requireSessionOrRedirect } from "@/lib/auth/guards";
import { getUserForAdmin } from "@/lib/users/admin";
import { UserForm } from "../_components/user-form";

export const metadata = { title: "Editar usuario · Administración" };

export default async function EditUserPage({ params }: PageProps<"/admin/usuarios/[id]">) {
  const { id: rawId } = await params;
  const id = /^\d+$/.test(rawId) ? Number(rawId) : NaN;
  await requireSessionOrRedirect(["admin"], `/admin/usuarios/${encodeURIComponent(rawId)}`);
  const user = Number.isSafeInteger(id) ? await getUserForAdmin(getDb(), id) : null;
  if (!user) notFound();
  return (
    <section className="flex flex-col gap-5">
      <h1 className="font-display text-3xl font-extrabold text-brand-600">Editar usuario</h1>
      <UserForm key={user.id} initial={user} />
    </section>
  );
}
