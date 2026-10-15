import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getDb } from "@/db/client";
import { requireSessionOrRedirect } from "@/lib/auth/guards";
import { listMenuForAdmin } from "@/lib/menu/admin-queries";
import { CategorySection } from "./_components/category-section";

export const metadata = { title: "Menú · Administración" };

export default async function AdminMenuPage() {
  await requireSessionOrRedirect(["admin"], "/admin/menu");
  const menu = await listMenuForAdmin(getDb());
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-extrabold text-brand-600">Menú</h1>
        <div className="flex gap-2">
          <Link href="/admin/menu/categorias/nueva" className={buttonClass("secondary")}>
            Nueva categoría
          </Link>
          <Link href="/admin/menu/productos/nuevo" className={buttonClass("primary")}>
            Nuevo producto
          </Link>
        </div>
      </div>
      {menu.length === 0 ? (
        <Card>
          <p className="text-ink-muted">Todavía no hay categorías. Creá la primera para empezar a cargar productos.</p>
        </Card>
      ) : (
        menu.map((c, i) => <CategorySection key={c.id} category={c} first={i === 0} last={i === menu.length - 1} />)
      )}
    </section>
  );
}
