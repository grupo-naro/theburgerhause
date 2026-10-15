export function assertCents(n: number): void {
  if (!Number.isInteger(n)) {
    throw new Error(`El importe debe ser un entero en centavos, recibido: ${n}`);
  }
}

export function formatARS(cents: number): string {
  assertCents(cents);
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/** Whole pesos (what admins type) -> integer centavos (what the DB stores). */
export function pesosToCents(pesos: number): number {
  if (!Number.isInteger(pesos)) {
    throw new Error(`Los pesos deben ser un entero, recibido: ${pesos}`);
  }
  return pesos * 100;
}

/** Centavos -> whole pesos, rounded to the nearest peso. */
export function centsToPesos(cents: number): number {
  assertCents(cents);
  return Math.round(cents / 100);
}
