import { requireSessionOrRedirect } from "@/lib/auth/guards";
import { GroupForm } from "../../_components/group-form";

export const metadata = { title: "Nuevo grupo · Administración" };

export default async function NewGroupPage() {
  await requireSessionOrRedirect(["admin"], "/admin/modificadores/grupos/nuevo");
  return (
    <section className="flex flex-col gap-5">
      <h1 className="font-display text-3xl font-extrabold text-brand-600">Nuevo grupo</h1>
      <GroupForm initial={{ name: "" }} />
    </section>
  );
}
