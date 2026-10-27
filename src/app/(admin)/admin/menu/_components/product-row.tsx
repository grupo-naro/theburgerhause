import Link from "next/link";
import { ActionButton } from "@/components/ui/action-button";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { formatARS } from "@/domain/money";
import type { AdminProduct } from "@/lib/menu/admin-queries";
import { moveProductAction, toggleProductActiveAction, toggleProductFeaturedAction } from "../actions";
import { Thumb } from "./thumb";

export function ProductRow({ product, first, last }: { product: AdminProduct; first: boolean; last: boolean }) {
  return (
    <tr className={product.active ? "" : "bg-slate-50 text-ink-muted"}>
      <td className="py-2 pr-3">
        <Thumb path={product.imagePath} alt={product.name} />
      </td>
      <td className="py-2 pr-3 font-medium">{product.name}</td>
      <td className="py-2 pr-3 whitespace-nowrap">{formatARS(product.price)}</td>
      <td className="py-2 pr-3">
        <Badge tone={product.active ? "success" : "muted"}>{product.active ? "Activo" : "Inactivo"}</Badge>
        {product.stockPaused ? <Badge tone="muted">Sin stock</Badge> : null}
      </td>
      <td className="py-2 pr-3 text-center">
        {product.featured ? (
          <span role="img" aria-label="Destacado" className="text-cheddar-600">
            ★
          </span>
        ) : (
          <span aria-hidden="true">–</span>
        )}
      </td>
      <td className="py-2">
        <div className="flex flex-wrap items-start gap-1">
          <ActionButton
            action={moveProductAction}
            fields={{ id: product.id, dir: "up" }}
            label={`Subir ${product.name}`}
            disabled={first}
          >
            ↑
          </ActionButton>
          <ActionButton
            action={moveProductAction}
            fields={{ id: product.id, dir: "down" }}
            label={`Bajar ${product.name}`}
            disabled={last}
          >
            ↓
          </ActionButton>
          <ActionButton
            action={toggleProductActiveAction}
            fields={{ id: product.id, value: String(!product.active) }}
            label={`${product.active ? "Desactivar" : "Activar"} ${product.name}`}
          >
            {product.active ? "Desactivar" : "Activar"}
          </ActionButton>
          <ActionButton
            action={toggleProductFeaturedAction}
            fields={{ id: product.id, value: String(!product.featured) }}
            label={`${product.featured ? "Quitar destacado de" : "Destacar"} ${product.name}`}
          >
            {product.featured ? "Quitar ★" : "Destacar ★"}
          </ActionButton>
          <Link href={`/admin/menu/productos/${product.id}`} className={buttonClass("ghost", "sm")}>
            Editar
          </Link>
        </div>
      </td>
    </tr>
  );
}
