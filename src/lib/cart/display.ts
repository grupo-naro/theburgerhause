import { formatARS } from "@/domain/money";
import type { PublicModifier, PublicProduct } from "@/lib/menu/public";
import type { MenuIndex } from "./pricing";
import type { CartIssue } from "./types";

/** The chosen modifiers of a unit in DISPLAY order (product group order, then modifier order). */
export function selectedModifiers(product: PublicProduct, modifierIds: readonly number[]): PublicModifier[] {
  const wanted = new Set(modifierIds);
  return product.modifierGroups.flatMap((g) => g.modifiers.filter((m) => wanted.has(m.id)));
}

const units = (n: number) => (n > 1 ? ` (${n} unidades)` : "");

/** Spanish (es-AR) sentences for the "what changed in your order" banner. */
export function issueMessages(issues: readonly CartIssue[], index: MenuIndex): string[] {
  return issues.map((issue) => {
    const productName = index.products.get(issue.productId)?.name;
    switch (issue.type) {
      case "product_unavailable":
        return issue.name
          ? `«${issue.name}» ya no está disponible y se quitó de tu pedido${issue.quantity > 1 ? ` (${issue.quantity} unidades)` : ""}.`
          : `Un producto que ya no está disponible se quitó de tu pedido${units(issue.quantity)}.`;
      case "modifier_unavailable": {
        const of = productName ? `«${productName}»` : "un producto";
        const names = issue.modifierIds.flatMap((id) => {
          const name = index.modifiers.get(id)?.modifier.name;
          return name ? [`«${name}»`] : [];
        });
        return names.length > 0 && names.length === issue.modifierIds.length
          ? `Se quitó ${names.join(", ")} de ${of}${units(issue.quantity)}.`
          : `Se quitaron opciones que ya no están disponibles de ${of}${units(issue.quantity)}.`;
      }
      case "price_changed":
        return `El precio de ${productName ? `«${productName}»` : "un producto"} cambió de ${formatARS(issue.from)} a ${formatARS(issue.to)}${units(issue.quantity)}.`;
    }
  });
}
