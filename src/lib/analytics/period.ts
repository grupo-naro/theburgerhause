import { businessDateFor, cutoffMinutes, DEFAULT_BUSINESS_DAY_CUTOFF } from "@/db/order-number";

/**
 * Period resolution for the analytics page (spec 2026-11-07 §"Período y comparación"). Pure.
 * Dates are business dates `YYYY-MM-DD`, inclusive. Buenos Aires is a fixed UTC−03:00 (no DST).
 */

export type PeriodKind = "hoy" | "semana" | "mes" | "custom";

export type Period = {
  kind: PeriodKind;
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  /** Non-null only when `to` is today's business day: orders on `prevTo` count only if created before it. */
  prevCutAt: Date | null;
};

const DAY_MS = 86_400_000;
const BA_OFFSET_MS = 3 * 3_600_000;
const MAX_CUSTOM_DAYS = 366;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` -> UTC-midnight ms, or null when it is not a real calendar date. */
function parseDate(s: string | undefined): number | null {
  const m = s ? DATE_RE.exec(s) : null;
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  return back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d ? ms : null;
}

const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (date: string, n: number) => fmt((parseDate(date) as number) + n * DAY_MS);

/** The instant `date` + cutoff in Buenos Aires. */
export function businessDayStart(date: string, cutoff: string): Date {
  const minutes = cutoffMinutes(cutoff) ?? (cutoffMinutes(DEFAULT_BUSINESS_DAY_CUTOFF) as number);
  return new Date((parseDate(date) as number) + minutes * 60_000 + BA_OFFSET_MS);
}

/** Rounded % change; null when there is no base to compare with. */
export function pctChange(cur: number, prev: number): number | null {
  if (prev === 0) return null;
  return Math.round(((cur - prev) / prev) * 100);
}

function ranges(kind: PeriodKind, today: string, q: { desde?: string; hasta?: string }) {
  const t = parseDate(today) as number;
  if (kind === "hoy") return { from: today, to: today, prevFrom: addDays(today, -7), prevTo: addDays(today, -7) };
  if (kind === "semana") {
    const isoDow = ((new Date(t).getUTCDay() + 6) % 7) + 1; // 1 = Monday
    const from = addDays(today, -(isoDow - 1));
    return { from, to: today, prevFrom: addDays(from, -7), prevTo: addDays(today, -7) };
  }
  if (kind === "mes") {
    const d = new Date(t);
    const [y, m, day] = [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()];
    const lastPrev = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return {
      from: fmt(Date.UTC(y, m, 1)),
      to: today,
      prevFrom: fmt(Date.UTC(y, m - 1, 1)),
      prevTo: fmt(Date.UTC(y, m - 1, Math.min(day, lastPrev))),
    };
  }
  const from = parseDate(q.desde);
  const to = parseDate(q.hasta);
  if (from === null || to === null || to < from) return null;
  const n = (to - from) / DAY_MS + 1;
  if (n > MAX_CUSTOM_DAYS) return null;
  return { from: fmt(from), to: fmt(to), prevFrom: fmt(from - n * DAY_MS), prevTo: fmt(from - DAY_MS) };
}

const KINDS: readonly PeriodKind[] = ["hoy", "semana", "mes", "custom"];

export function resolvePeriod(query: { p?: string; desde?: string; hasta?: string }, now: Date, cutoff: string): Period {
  const today = businessDateFor(now, cutoff);
  let kind: PeriodKind = KINDS.includes(query.p as PeriodKind) ? (query.p as PeriodKind) : "semana";
  let r = ranges(kind, today, query);
  if (!r) {
    kind = "semana";
    r = ranges(kind, today, query)!;
  }
  const prevCutAt =
    r.to === today
      ? new Date(businessDayStart(r.prevTo, cutoff).getTime() + (now.getTime() - businessDayStart(today, cutoff).getTime()))
      : null;
  return { kind, ...r, prevCutAt };
}
