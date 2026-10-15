import type { OrderUnitInput } from "@/lib/cart/types";
import type { UnitIssue, UnitIssueCode } from "@/lib/orders/resolve-units";

/**
 * Spanish sentences for the "algunos productos ya no están disponibles" banner: the server reports
 * unit indexes, we know which cart units were sent, so we can name the products. Repeated issues
 * (same product, same reason) collapse into one sentence with a unit count.
 */
export function describeUnitIssues(
  issues: readonly UnitIssue[],
  sent: readonly OrderUnitInput[],
  names: ReadonlyMap<number, string>,
): string[] {
  const grouped = new Map<string, { name: string | undefined; code: UnitIssueCode; count: number }>();
  for (const issue of issues) {
    const productId = sent[issue.unitIndex]?.productId;
    const name = productId === undefined ? undefined : names.get(productId);
    const key = `${productId ?? "?"}|${issue.code}`;
    const entry = grouped.get(key) ?? { name, code: issue.code, count: 0 };
    entry.count += 1;
    grouped.set(key, entry);
  }
  return [...grouped.values()].map(({ name, code, count }) => {
    const units = count > 1 ? ` (${count} unidades)` : "";
    const quoted = name ? `«${name}»` : null;
    switch (code) {
      case "PRODUCT_UNAVAILABLE":
        return `${quoted ?? "Un producto"} ya no está disponible${units}.`;
      case "MODIFIER_UNAVAILABLE":
        return `Alguna opción elegida para ${quoted ?? "un producto"} ya no está disponible${units}.`;
      case "INVALID_SELECTION":
        return `La combinación elegida para ${quoted ?? "un producto"} no es válida${units}.`;
    }
  });
}

/** Line ids (from the snapshot of lines that were SENT) whose product no longer exists / is inactive. */
export function unavailableLineIds(issues: readonly UnitIssue[], sentLines: readonly { id: string }[]): string[] {
  return issues.flatMap((i) => {
    const line = i.code === "PRODUCT_UNAVAILABLE" ? sentLines[i.unitIndex] : undefined;
    return line ? [line.id] : [];
  });
}
