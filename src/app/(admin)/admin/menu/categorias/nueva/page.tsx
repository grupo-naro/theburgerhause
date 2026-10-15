import { requireSessionOrRedirect } from "@/lib/auth/guards";
import { CategoryForm } from "../../_components/category-form";

export const metadata = { title: "Nueva categoría · Administración" };

export default async function NewCategoryPage() {
  await requireSessionOrRedirect(["admin"], "/admin/menu/categorias/nueva");
  return (
    <section className="flex flex-col gap-5">
      <h1 className="font-display text-3xl font-extrabold text-brand-600">Nueva categoría</h1>
      <CategoryForm initial={{ name: "", slug: "", active: true, imagePath: null }} previewUrl={null} />
    </section>
  );
}
