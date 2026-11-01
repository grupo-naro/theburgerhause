import { asc } from "drizzle-orm";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { requireSessionOrRedirect } from "@/lib/auth/guards";
import { listLinkableDrinks } from "@/lib/stock/queries";
import { ProductForm } from "../../_components/product-form";

export const metadata = { title: "Nuevo producto · Administración" };

export default async function NewProductPage({ searchParams }: PageProps<"/admin/menu/productos/nuevo">) {
  const sp = await searchParams;
  await requireSessionOrRedirect(["admin", "encargado"], "/admin/menu/productos/nuevo");
  const drinks = await listLinkableDrinks(getDb());
  const categories = await getDb()
    .select({ id: s.categories.id, name: s.categories.name })
    .from(s.categories)
    .orderBy(asc(s.categories.sort), asc(s.categories.id));
  // Untrusted query param: only preselect when it matches an existing category.
  const raw = typeof sp.categoria === "string" && /^\d+$/.test(sp.categoria) ? Number(sp.categoria) : null;
  const categoryId = categories.some((c) => c.id === raw) ? raw : null;
  return (
    <section className="flex flex-col gap-5">
      <h1 className="font-display text-3xl font-extrabold text-brand-600">Nuevo producto</h1>
      <ProductForm
        categories={categories}
        previewUrl={null}
        drinks={drinks}
        initial={{
          categoryId,
          name: "",
          description: "",
          priceArs: null,
          active: true,
          featured: false,
          suggest: false,
          imagePath: null,
          stockItemId: null,
        }}
      />
    </section>
  );
}
