import { requireSessionOrRedirect } from "@/lib/auth/guards";
import { ItemForm } from "../../_components/item-form";

export const metadata = { title: "Nuevo artículo · Administración" };

export default async function NuevoArticuloPage() {
  await requireSessionOrRedirect(["admin", "encargado"], "/admin/stock/articulos/nuevo");
  return (
    <section className="flex flex-col gap-5">
      <h1 className="font-display text-3xl font-extrabold text-brand-600">Nuevo artículo</h1>
      <ItemForm initial={{ name: "", kind: "materia_prima", unit: "kg", minQty: "", active: true }} />
    </section>
  );
}
