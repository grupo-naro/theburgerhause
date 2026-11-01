/**
 * Dates of the "Rendición de materia prima" (pure: safe on the client). A rendición belongs to a
 * Buenos Aires CALENDAR day (YYYY-MM-DD). Argentina has no daylight saving time since 2009, so
 * Buenos Aires is a fixed UTC-3 and the arithmetic needs no time zone database.
 */

const BA_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Today's date in Buenos Aires for the given instant ("2026-10-30"). */
export function buenosAiresToday(now: Date): string {
  return new Date(now.getTime() - BA_OFFSET_MS).toISOString().slice(0, 10);
}

/** The date `days` before `date` (both YYYY-MM-DD). */
export function shiftDate(date: string, days: number): string {
  const t = new Date(`${date}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() - days);
  return t.toISOString().slice(0, 10);
}

export const CLOSING_DATE_MESSAGES = {
  future: "Ese día todavía no llegó: elegí hoy o un día anterior.",
  closed: "La rendición de ese día ya está cerrada. Para corregirla usá el Historial.",
} as const;

/** Why `date` cannot be closed today, or null when it can (any past or present day not closed yet). */
export function closingDateProblem(date: string, today: string, closedDates: ReadonlySet<string> | readonly string[]): string | null {
  if (date > today) return CLOSING_DATE_MESSAGES.future;
  const closed = closedDates instanceof Set ? closedDates.has(date) : (closedDates as readonly string[]).includes(date);
  return closed ? CLOSING_DATE_MESSAGES.closed : null;
}

const WEEKDAY = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MONTH = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/**
 * A date as people say it: "jueves 30" within the last week (the day number is unambiguous there),
 * "jueves 30 de octubre" further back, plus the year when it is not the current one.
 */
export function friendlyDay(date: string, today: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const base = `${WEEKDAY[d.getUTCDay()]} ${d.getUTCDate()}`;
  if (date <= today && date > shiftDate(today, 7)) return base;
  const withMonth = `${base} de ${MONTH[d.getUTCMonth()]}`;
  return date.slice(0, 4) === today.slice(0, 4) ? withMonth : `${withMonth} de ${date.slice(0, 4)}`;
}

/** "viernes 30/10/2026": the full date for headings and summaries. */
export function longDay(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return `${WEEKDAY[d.getUTCDay()]} ${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
}

/**
 * Text of the reminder shown to managers while TODAY's rendición is not closed; null once it is.
 * `lastClosed` is the latest closed date (null if none was ever closed).
 */
export function closingReminderText(lastClosed: string | null, today: string): string | null {
  if (lastClosed !== null && lastClosed >= today) return null;
  if (lastClosed === null) return "Todavía no se cerró ninguna rendición de materia prima.";
  return `La última rendición de materia prima cerrada es del ${friendlyDay(lastClosed, today)}. Todavía no se cerró la de hoy.`;
}
