import Link from "next/link";
import { ActionButton } from "@/components/ui/action-button";
import { buttonClass } from "@/components/ui/button";
import { OverflowMenu } from "@/components/ui/overflow-menu";
import { formatARS } from "@/domain/money";
import type { AdminProduct } from "@/lib/menu/admin-queries";
import {
  moveProductAction,
  toggleProductActiveAction,
  toggleProductFeaturedAction,
} from "../actions";
import { Thumb } from "./thumb";

/** Phone layout of one product (the md+ layout is the table row). */
export function ProductCard({
  product,
  first,
  last,
}: {
  product: AdminProduct;
  first: boolean;
  last: boolean;
}) {
  return (
    <li
      className={`flex flex-col gap-3 rounded-2xl border border-line p-3 ${product.active ? "bg-surface" : "bg-slate-50 opacity-80"}`}
    >
      <div className="flex items-start gap-3">
        <Thumb path={product.imagePath} alt={product.name} size={64} />
        <div className="min-w-0 flex-1">
          <p
            className={`font-medium [overflow-wrap:anywhere] ${product.active ? "" : "text-ink-muted"}`}
          >
            {product.name}
          </p>
          <p className="text-sm text-ink-muted">{formatARS(product.price)}</p>
          {product.stockPaused ? (
            <span className="mt-1 mr-1 inline-block rounded-full bg-state-error/15 px-2 py-0.5 text-xs font-semibold text-state-error">
              Sin stock
            </span>
          ) : null}
          {product.featured ? (
            <span className="mt-1 inline-block rounded-full bg-cheddar-400/30 px-2 py-0.5 text-xs font-semibold text-ink">
              Destacado
            </span>
          ) : null}
        </div>
      </div>
      <ActionButton
        action={toggleProductActiveAction}
        fields={{ id: product.id, value: String(!product.active) }}
        label={`${product.active ? "Desactivar" : "Activar"} ${product.name}`}
        variant={product.active ? "primary" : "secondary"}
        size="md"
        fullWidth
        className={
          product.active
            ? "bg-state-ready! hover:bg-state-ready!"
            : "text-ink-muted"
        }
      >
        {product.active ? "Activo" : "Pausado"}
      </ActionButton>
      <div className="flex items-start gap-2">
        <Link
          href={`/admin/menu/productos/${product.id}`}
          className={`${buttonClass("secondary", "md")} flex-1`}
        >
          Editar
        </Link>
        <OverflowMenu label={`Más acciones de ${product.name}`}>
          <ActionButton
            action={toggleProductFeaturedAction}
            fields={{ id: product.id, value: String(!product.featured) }}
            label={`${product.featured ? "Quitar destacado de" : "Destacar"} ${product.name}`}
          >
            {product.featured ? "Quitar destacado" : "Destacar"}
          </ActionButton>
          <ActionButton
            action={moveProductAction}
            fields={{ id: product.id, dir: "up" }}
            label={`Subir ${product.name}`}
            disabled={first}
          >
            Subir
          </ActionButton>
          <ActionButton
            action={moveProductAction}
            fields={{ id: product.id, dir: "down" }}
            label={`Bajar ${product.name}`}
            disabled={last}
          >
            Bajar
          </ActionButton>
        </OverflowMenu>
      </div>
    </li>
  );
}
