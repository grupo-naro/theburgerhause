import Link from "next/link";
import { ActionButton } from "@/components/ui/action-button";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { AdminMenuCategory } from "@/lib/menu/admin-queries";
import { OverflowMenu } from "@/components/ui/overflow-menu";
import { moveCategoryAction, toggleCategoryActiveAction } from "../actions";
import { ProductCard } from "./product-card";
import { ProductRow } from "./product-row";
import { Thumb } from "./thumb";

const th = "pb-1 pr-3 font-semibold";

export function CategorySection({
  category,
  first,
  last,
}: {
  category: AdminMenuCategory;
  first: boolean;
  last: boolean;
}) {
  const { products } = category;
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Thumb path={category.imagePath} alt={category.name} size={56} />
        <h2 className="font-display text-2xl font-extrabold">
          {category.name}
        </h2>
        <Badge tone={category.active ? "success" : "muted"}>
          {category.active ? "Activa" : "Inactiva"}
        </Badge>
        <div className="ml-auto flex items-start gap-2 md:hidden">
          <Link
            href={`/admin/menu/categorias/${category.id}`}
            className={buttonClass("secondary", "sm")}
          >
            Editar
          </Link>
          <Link
            href={`/admin/menu/productos/nuevo?categoria=${category.id}`}
            className={buttonClass("primary", "sm")}
          >
            Nuevo producto
          </Link>
          <OverflowMenu label={`Más acciones de la categoría ${category.name}`}>
            <ActionButton
              action={moveCategoryAction}
              fields={{ id: category.id, dir: "up" }}
              label={`Subir categoría ${category.name}`}
              disabled={first}
            >
              Subir
            </ActionButton>
            <ActionButton
              action={moveCategoryAction}
              fields={{ id: category.id, dir: "down" }}
              label={`Bajar categoría ${category.name}`}
              disabled={last}
            >
              Bajar
            </ActionButton>
            <ActionButton
              action={toggleCategoryActiveAction}
              fields={{ id: category.id, value: String(!category.active) }}
              label={`${category.active ? "Desactivar" : "Activar"} categoría ${category.name}`}
            >
              {category.active ? "Desactivar" : "Activar"}
            </ActionButton>
          </OverflowMenu>
        </div>
        <div className="ml-auto hidden flex-wrap items-start gap-1 md:flex">
          <ActionButton
            action={moveCategoryAction}
            fields={{ id: category.id, dir: "up" }}
            label={`Subir categoría ${category.name}`}
            disabled={first}
          >
            ↑
          </ActionButton>
          <ActionButton
            action={moveCategoryAction}
            fields={{ id: category.id, dir: "down" }}
            label={`Bajar categoría ${category.name}`}
            disabled={last}
          >
            ↓
          </ActionButton>
          <ActionButton
            action={toggleCategoryActiveAction}
            fields={{ id: category.id, value: String(!category.active) }}
            label={`${category.active ? "Desactivar" : "Activar"} categoría ${category.name}`}
          >
            {category.active ? "Desactivar" : "Activar"}
          </ActionButton>
          <Link
            href={`/admin/menu/categorias/${category.id}`}
            className={buttonClass("ghost", "sm")}
          >
            Editar
          </Link>
          <Link
            href={`/admin/menu/productos/nuevo?categoria=${category.id}`}
            className={buttonClass("primary", "sm")}
          >
            Nuevo producto
          </Link>
        </div>
      </div>
      {products.length === 0 ? (
        <p className="text-sm text-ink-muted">
          Esta categoría todavía no tiene productos.
        </p>
      ) : (
        <>
          <ul
            role="list"
            aria-label={`Productos de ${category.name}`}
            className="flex flex-col gap-3 md:hidden"
          >
            {products.map((p, i) => (
              <ProductCard
                key={p.id}
                product={p}
                first={i === 0}
                last={i === products.length - 1}
              />
            ))}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[60rem] table-fixed text-left text-sm">
              <caption className="sr-only">
                Productos de {category.name}
              </caption>
              <thead className="text-xs text-ink-muted uppercase">
                <tr>
                  <th scope="col" className={`${th} w-16`}>
                    Foto
                  </th>
                  <th scope="col" className={th}>
                    Nombre
                  </th>
                  <th scope="col" className={`${th} w-28`}>
                    Precio
                  </th>
                  <th scope="col" className={`${th} w-24`}>
                    Estado
                  </th>
                  <th scope="col" className={`${th} text-center w-24`}>
                    Destacado
                  </th>
                  <th scope="col" className="pb-1 font-semibold w-[26rem]">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {products.map((p, i) => (
                  <ProductRow
                    key={p.id}
                    product={p}
                    first={i === 0}
                    last={i === products.length - 1}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
