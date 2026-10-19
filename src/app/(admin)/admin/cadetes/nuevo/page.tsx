import { getDb } from "@/db/client";
import { requireSessionOrRedirect } from "@/lib/auth/guards";
import { listCadets } from "@/lib/cadets/admin";
import { CadetForm } from "../_components/cadet-form";

export const metadata = { title: "Nuevo cadete · Administración" };

export default async function NewCadetPage() {
  await requireSessionOrRedirect(["admin", "encargado"], "/admin/cadetes/nuevo");
  const names = (await listCadets(getDb())).filter((c) => c.active).map((c) => c.name);
  return (
    <section className="flex flex-col gap-5">
      <h1 className="font-display text-3xl font-extrabold text-brand-600">Nuevo cadete</h1>
      <CadetForm initial={{ name: "", phone: "", active: true }} otherActiveNames={names} />
    </section>
  );
}
