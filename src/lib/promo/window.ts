/**
 * Pure rules of the store promotion (no db, no next/*; safe for client code).
 * Dates are `Date`s (instants); the admin form speaks Buenos Aires wall-clock time, see `parseBaInput`.
 */

export type PromoWindow = {
  imagePath: string | null;
  active: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
};

/** Showing iff active, an image is set, and `now` is in [startsAt, endsAt) (a null bound is open). */
export function isPromoShowing(promo: PromoWindow | null, now: Date): boolean {
  if (!promo || !promo.active || !promo.imagePath) return false;
  const t = now.getTime();
  if (promo.startsAt && t < promo.startsAt.getTime()) return false;
  if (promo.endsAt && t >= promo.endsAt.getTime()) return false;
  return true;
}

/**
 * Identity of a promotion for the "already seen in this visit" flag: any edit (new image, title,
 * dates, re-save) changes `updatedAt`, so a changed promotion shows again within the same session.
 */
export function promoVersion(promo: { updatedAt: Date; imagePath: string | null; title: string | null }): string {
  return `${promo.updatedAt.getTime()}:${promo.imagePath ?? ""}:${promo.title ?? ""}`;
}

export const PROMO_SEEN_PREFIX = "bh:promo-seen:";
export const promoSeenKey = (version: string) => `${PROMO_SEEN_PREFIX}${version}`;

/**
 * Routes where a customer may be shown the promotion: the store home only (the menu and product links
 * live there). Cart, checkout and order tracking never show it.
 */
export const isPromoRoute = (pathname: string) => pathname === "/";

// Argentina has no daylight saving time since 2009: Buenos Aires is a fixed UTC-3.
const BA_OFFSET_MS = 3 * 60 * 60 * 1000;
const INPUT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** `datetime-local` text ("2026-10-31T20:00", Buenos Aires wall clock) -> instant; null when malformed. */
export function parseBaInput(value: string): Date | null {
  const m = INPUT_RE.exec(value.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const utc = new Date(Date.UTC(y, mo - 1, d, h, mi));
  // Reject overflow such as 2026-02-31 or 25:00 (Date.UTC would roll over).
  if (utc.getUTCFullYear() !== y || utc.getUTCMonth() !== mo - 1 || utc.getUTCDate() !== d || utc.getUTCHours() !== h) {
    return null;
  }
  return new Date(utc.getTime() + BA_OFFSET_MS);
}

/** Instant -> `datetime-local` text in Buenos Aires wall clock ("" for null). */
export function toBaInput(date: Date | null): string {
  if (!date) return "";
  return new Date(date.getTime() - BA_OFFSET_MS).toISOString().slice(0, 16);
}
