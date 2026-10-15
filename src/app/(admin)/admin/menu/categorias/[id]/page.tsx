import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { requireSessionOrRedirect } from "@/lib/auth/guards";
import { getCategoryForAdmin } from "@/lib/menu/admin-queries";
import { thumbUrl } from "@/lib/uploads/storage";
import { CategoryForm } from "../../_components/category-form";

export const metadata = { title: "Editar categoría · Administración" };

export default async function EditCategoryPage({ params }: PageProps<"/admin/menu/categorias/[id]">) {
  const { id: rawId } = await params;
  const id = /^\d+$/.test(rawId) ? Number(rawId) : NaN;
  await requireSessionOrRedirect(["admin"], `/admin/menu/categorias/${encodeURIComponent(rawId)}`);
  const category = Number.isSafeInteger(id) ? await getCategoryForAdmin(getDb(), id) : null;
  if (!category) notFound();
  return (
    <section className="flex flex-col gap-5">
      <h1 className="font-display text-3xl font-extrabold text-brand-600">Editar categoría</h1>
      <CategoryForm
        key={category.id}
        initial={{
          id: category.id,
          name: category.name,
          slug: category.slug,
          active: category.active,
          imagePath: category.imagePath,
        }}
        previewUrl={category.imagePath ? thumbUrl(category.imagePath) : null}
      />
    </section>
  );
}
