import { asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { centsToPesos } from "@/domain/money";
import { requireSessionOrRedirect } from "@/lib/auth/guards";
import { getProductForAdmin } from "@/lib/menu/admin-queries";
import { comboIds, getComboItems } from "@/lib/menu/combos";
import { listLinkableDrinks } from "@/lib/stock/queries";
import { listProductGroupIds } from "@/lib/modifiers/admin";
import { thumbUrl } from "@/lib/uploads/storage";
import { ProductForm } from "../../_components/product-form";
import { ComboItemsForm } from "../../_components/combo-items-form";
import { ProductModifierGroupsForm } from "../../_components/product-modifier-groups-form";

export const metadata = { title: "Editar producto · Administración" };

export default async function EditProductPage({ params }: PageProps<"/admin/menu/productos/[id]">) {
  const { id: rawId } = await params;
  const id = /^\d+$/.test(rawId) ? Number(rawId) : NaN;
  const session = await requireSessionOrRedirect(["admin", "encargado"], `/admin/menu/productos/${encodeURIComponent(rawId)}`);
  const isAdmin = session.user.role === "admin";
  const db = getDb();
  const product = Number.isSafeInteger(id) ? await getProductForAdmin(db, id) : null;
  if (!product) notFound();
  const categories = await db
    .select({ id: s.categories.id, name: s.categories.name })
    .from(s.categories)
    .orderBy(asc(s.categories.sort), asc(s.categories.id));
  const [drinks, groups, linkedIds] = await Promise.all([
    listLinkableDrinks(db, product.id),
    db
      .select({ id: s.modifierGroups.id, name: s.modifierGroups.name })
      .from(s.modifierGroups)
      .orderBy(asc(s.modifierGroups.id)),
    listProductGroupIds(db, product.id),
  ]);
  // Combo contents: options exclude this product and every combo (no nesting).
  const [comboItems, combos, allProducts, [inside]] = await Promise.all([
    getComboItems(db, product.id),
    comboIds(db),
    db.select({ id: s.products.id, name: s.products.name, price: s.products.price }).from(s.products).orderBy(asc(s.products.name)),
    db.select({ id: s.comboItems.comboId }).from(s.comboItems).where(eq(s.comboItems.productId, product.id)).limit(1),
  ]);
  const insideCombo = inside !== undefined;
  const comboOptions = allProducts.filter((p) => p.id !== product.id && !combos.has(p.id));
  return (
    <section className="flex flex-col gap-5">
      <h1 className="font-display text-3xl font-extrabold text-brand-600">Editar producto</h1>
      <ProductForm
        key={product.id}
        categories={categories}
        previewUrl={product.imagePath ? thumbUrl(product.imagePath) : null}
        drinks={drinks}
        showCost={isAdmin}
        initial={{
          id: product.id,
          categoryId: product.categoryId,
          name: product.name,
          description: product.description ?? "",
          priceArs: centsToPesos(product.price),
          active: product.active,
          featured: product.featured,
          suggest: product.suggest,
          imagePath: product.imagePath,
          stockItemId: product.stockItemId,
          patties: product.patties,
          // The cost is sent to the admin only.
          ...(isAdmin ? { costArs: product.cost === null ? null : centsToPesos(product.cost) } : {}),
        }}
      />
      <hr className="max-w-xl border-line" />
      <ProductModifierGroupsForm
        key={`groups-${product.id}`}
        productId={product.id}
        groups={groups}
        linkedIds={linkedIds}
      />
      <hr className="max-w-xl border-line" />
      {insideCombo ? (
        <p className="max-w-xl text-sm text-ink-muted">Este producto está dentro de un combo: no puede ser un combo.</p>
      ) : (
        <ComboItemsForm
          key={`combo-${product.id}`}
          comboId={product.id}
          comboPrice={product.price}
          options={comboOptions}
          initial={comboItems.map((i) => ({ productId: i.productId, quantity: i.quantity }))}
        />
      )}
    </section>
  );
}
