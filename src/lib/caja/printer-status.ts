import { ONLINE_WINDOW_MS } from "@/lib/stations/schemas";

export type PrinterStatus = {
  /** The station's print agent pinged within the online window. */
  online: boolean;
  tone: "ok" | "error";
  label: string;
  failedCount: number;
};

/**
 * Truthful printer indicator from the station's `last_seen_at` and its FAILED jobs. Before the
 * agent exists it simply reads "Sin agente". Online window: 90 s (boundary inclusive).
 */
export function derivePrinterStatus(args: {
  lastSeenAt: string | null;
  failedCount: number;
  now: Date;
}): PrinterStatus {
  const seen = args.lastSeenAt === null ? NaN : Date.parse(args.lastSeenAt);
  const online = !Number.isNaN(seen) && args.now.getTime() - seen <= ONLINE_WINDOW_MS;
  const failedCount = Math.max(0, Math.floor(args.failedCount));
  if (failedCount > 0) {
    const label = online
      ? `${failedCount} ${failedCount === 1 ? "impresión fallida" : "impresiones fallidas"}`
      : `Sin agente · ${failedCount} ${failedCount === 1 ? "fallida" : "fallidas"}`;
    return { online, tone: "error", label, failedCount };
  }
  return online
    ? { online, tone: "ok", label: "Impresora lista", failedCount }
    : { online, tone: "error", label: "Sin agente", failedCount };
}
