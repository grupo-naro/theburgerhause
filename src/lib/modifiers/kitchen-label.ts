export type ModifierKind = "remove" | "add" | "swap";

const squash = (v: string) => v.trim().replace(/\s+/g, " ");
const upper = (v: string) => squash(v).toLocaleUpperCase("es-AR");

/**
 * The text the kitchen ticket prints for a modifier. ALWAYS uppercase (es-AR,
 * so ñ and accents survive), trimmed, with inner whitespace collapsed.
 *
 * An explicit `raw` label wins (only normalized). When it is blank we derive it:
 * - remove: `SIN <NAME>`; a leading "sin " in the name is stripped first
 *   ("Sin cheddar" -> "SIN CHEDDAR", "sin  Tomate" -> "SIN TOMATE").
 * - add: `+ <NAME>`; names that already start with "+" keep it ("+Dips" ->
 *   "+ DIPS") and names that start with "agregar"/"extra" keep their own
 *   wording ("Agregar tomate" -> "AGREGAR TOMATE").
 * - swap: the name uppercased ("Papas grandes" -> "PAPAS GRANDES").
 * Pure and dependency-free: the admin form uses it for the live preview.
 */
export function normalizeKitchenLabel(name: string, kind: ModifierKind, raw?: string | null): string {
  if (raw && raw.trim() !== "") return upper(raw);
  const n = squash(name);
  if (n === "") return "";
  switch (kind) {
    case "remove": {
      const rest = n.replace(/^sin\s+/i, "");
      return `SIN ${upper(rest)}`;
    }
    case "add": {
      if (n.startsWith("+")) return upper(`+ ${n.replace(/^\+\s*/, "")}`);
      if (/^(agregar|extra)(\s|$)/i.test(n)) return upper(n);
      return upper(`+ ${n}`);
    }
    case "swap":
      return upper(n);
  }
}
