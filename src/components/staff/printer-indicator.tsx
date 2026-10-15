import type { PrinterStatus } from "@/lib/caja/printer-status";

/** Green when the print agent is alive and nothing failed; red otherwise. The text carries the meaning. */
export function PrinterIndicator({ status }: { status: PrinterStatus }) {
  const ok = status.tone === "ok";
  return (
    <span
      data-testid="printer-indicator"
      data-online={status.online}
      data-tone={status.tone}
      className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-bold whitespace-nowrap ${
        ok ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
      }`}
    >
      <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M7 9V4h10v5M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 14h10v6H7z" />
      </svg>
      {status.label}
    </span>
  );
}
