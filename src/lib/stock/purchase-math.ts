/** Pure purchase-price helpers (safe on the client: no DB, no zod). Money is integer centavos. */

/** Centavos: quantity (milli) × unit price (centavos per whole unit) / 1000, half up. BigInt keeps it exact. */
export function purchaseTotal(milli: number, unitPrice: number): number {
  const product = BigInt(milli) * BigInt(unitPrice);
  return Number((product + BigInt(500)) / BigInt(1000));
}

/** % change from `prev` to `cur`, rounded to one decimal, half away from zero (−6,25 → −6,3). */
export function priceChangePct(prev: number, cur: number): number {
  const raw = ((cur - prev) / prev) * 1000;
  const pct = (Math.sign(raw) * Math.round(Math.abs(raw))) / 10;
  return Object.is(pct, -0) ? 0 : pct;
}

/** "▲ 20%", "▼ 6,5%", "= 0%". */
export function formatPriceChange(pct: number): string {
  const abs = Math.abs(pct).toLocaleString("es-AR", { maximumFractionDigits: 1 });
  if (pct > 0) return `▲ ${abs}%`;
  if (pct < 0) return `▼ ${abs}%`;
  return "= 0%";
}

/** Money with centavos only when there are any: "$ 2.400", "$ 1.500,50". */
export function formatPurchaseMoney(cents: number): string {
  const whole = cents % 100 === 0;
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(cents / 100);
}
