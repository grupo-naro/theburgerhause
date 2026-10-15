import { asc } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { centsToPesos } from "@/domain/money";
import { requireSessionOrRedirect } from "@/lib/auth/guards";
import { getProductForAdmin } from "@/lib/menu/admin-queries";
import { listProductGroupIds } from "@/lib/modifiers/admin";
import { thumbUrl } from "@/lib/uploads/storage";
import { ProductForm } from "../../_components/product-form";
import { ProductModifierGroupsForm } from "../../_components/product-modifier-groups-form";

export const metadata = { title: "Editar producto · Administración" };

export default async function EditProductPage({ params }: PageProps<"/admin/menu/productos/[id]">) {
  const { id: rawId } = await params;
  const id = /^\d+$/.test(rawId) ? Number(rawId) : NaN;
  await requireSessionOrRedirect(["admin"], `/admin/menu/productos/${encodeURIComponent(rawId)}`);
  const db = getDb();
  const product = Number.isSafeInteger(id) ? await getProductForAdmin(db, id) : null;
  if (!product) notFound();
  const categories = await db
    .select({ id: s.categories.id, name: s.categories.name })
    .from(s.categories)
    .orderBy(asc(s.categories.sort), asc(s.categories.id));
  const [groups, linkedIds] = await Promise.all([
    db
      .select({ id: s.modifierGroups.id, name: s.modifierGroups.name })
      .from(s.modifierGroups)
      .orderBy(asc(s.modifierGroups.id)),
    listProductGroupIds(db, product.id),
  ]);
  return (
    <section className="flex flex-col gap-5">
      <h1 className="font-display text-3xl font-extrabold text-brand-600">Editar producto</h1>
      <ProductForm
        key={product.id}
        categories={categories}
        previewUrl={product.imagePath ? thumbUrl(product.imagePath) : null}
        initial={{
          id: product.id,
          categoryId: product.categoryId,
          name: product.name,
          description: product.description ?? "",
          priceArs: centsToPesos(product.price),
          active: product.active,
          featured: product.featured,
          imagePath: product.imagePath,
        }}
      />
      <hr className="max-w-xl border-line" />
      <ProductModifierGroupsForm
        key={`groups-${product.id}`}
        productId={product.id}
        groups={groups}
        linkedIds={linkedIds}
      />
    </section>
  );
}
