import { getDb } from "@/db/client";
import { buenosAiresToday, closingReminderText } from "@/lib/stock/closing-dates";
import { lastClosedDate } from "@/lib/stock/closings";

/** The reminder is a convenience: if its read fails, the shell renders without it. */
export async function loadClosingReminder(now: Date = new Date()): Promise<string | null> {
  try {
    return closingReminderText(await lastClosedDate(getDb()), buenosAiresToday(now));
  } catch {
    console.error("closing-reminder: last closing unavailable");
    return null;
  }
}
