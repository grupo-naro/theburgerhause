import { z } from "@/lib/zod";

/**
 * Cost price in whole pesos (admin only). undefined = leave the stored cost unchanged (forms that do not show the
 * field, e.g. the encargado's), null = clear it ("sin costo"), a number = set it. 0 is a valid cost.
 */
export const costArsSchema = z
  .number("Ingresá un costo")
  .int("El costo debe ser en pesos enteros")
  .min(0, "El costo no puede ser negativo")
  .max(100_000_000, "Costo demasiado alto")
  .nullable()
  .optional();

/** Form value: missing key = undefined (keep), "" = null (clear), anything else = Number() (NaN fails validation). */
export function costFromForm(fd: FormData): number | null | undefined {
  if (!fd.has("costArs")) return undefined;
  const raw = fd.get("costArs");
  const t = typeof raw === "string" ? raw.trim() : "";
  return t === "" ? null : Number(t);
}

/** Column value for an insert/update: undefined keeps (key omitted), null clears, pesos -> centavos. */
export function costColumn(costArs: number | null | undefined): { cost?: number | null } {
  if (costArs === undefined) return {};
  return { cost: costArs === null ? null : costArs * 100 };
}
