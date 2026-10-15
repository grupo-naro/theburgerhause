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
