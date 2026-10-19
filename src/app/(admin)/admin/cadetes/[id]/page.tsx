import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { requireSessionOrRedirect } from "@/lib/auth/guards";
import { getCadetForAdmin, listCadets } from "@/lib/cadets/admin";
import { CadetForm } from "../_components/cadet-form";

export const metadata = { title: "Editar cadete · Administración" };

export default async function EditCadetPage({ params }: PageProps<"/admin/cadetes/[id]">) {
  const { id: rawId } = await params;
  const id = /^\d+$/.test(rawId) ? Number(rawId) : NaN;
  await requireSessionOrRedirect(["admin", "encargado"], `/admin/cadetes/${encodeURIComponent(rawId)}`);
  const cadet = Number.isSafeInteger(id) ? await getCadetForAdmin(getDb(), id) : null;
  if (!cadet) notFound();
  const names = (await listCadets(getDb())).filter((c) => c.active && c.id !== cadet.id).map((c) => c.name);
  return (
    <section className="flex flex-col gap-5">
      <h1 className="font-display text-3xl font-extrabold text-brand-600">Editar cadete</h1>
      <CadetForm
        key={cadet.id}
        initial={{ id: cadet.id, name: cadet.name, phone: cadet.phone ?? "", active: cadet.active }}
        otherActiveNames={names}
      />
    </section>
  );
}
