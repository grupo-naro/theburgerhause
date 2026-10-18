/**
 * Age clock of the kitchen screen (pure, no db, no next/*): whole minutes since the order entered the
 * kitchen -> a colour. Thresholds come from the admin settings (kds_warn_minutes / kds_late_minutes).
 */

export type KitchenThresholds = { warnMin: number; lateMin: number };
export type AgeColor = "green" | "yellow" | "red";

export const DEFAULT_KDS_THRESHOLDS: KitchenThresholds = { warnMin: 8, lateMin: 15 };

const valid = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 480;

/** Thresholds from the settings; anything invalid (or warn >= late) falls back to the defaults as a PAIR. */
export function kitchenThresholds(s: { kdsWarnMinutes: number; kdsLateMinutes: number }): KitchenThresholds {
  return valid(s.kdsWarnMinutes) && valid(s.kdsLateMinutes) && s.kdsWarnMinutes < s.kdsLateMinutes
    ? { warnMin: s.kdsWarnMinutes, lateMin: s.kdsLateMinutes }
    : { ...DEFAULT_KDS_THRESHOLDS };
}

export function ageColor(minutes: number, t: KitchenThresholds): AgeColor {
  if (minutes >= t.lateMin) return "red";
  if (minutes >= t.warnMin) return "yellow";
  return "green";
}

/** "hace 7 min" / "hace 1 h 15 min". */
export function ageLabel(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  if (m === 0) return "recién entró";
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `hace ${h} h` : `hace ${h} h ${rest} min`;
}
