"use client";

import { usePathname } from "next/navigation";
import { InfoIcon } from "./icons";
import { useReportOrdersClosed } from "./store-status";

/**
 * "Not taking orders" notice. It FLOATS at the bottom of the viewport (fixed),
 * so it streams in without pushing any content or moving the sticky bars: the
 * header/category-bar offsets and the scrollspy line never depend on it.
 * (Task 4.2: the bottom order bar must be laid out together with this notice.)
 */
export function ClosedNotice({ hours }: { hours: string }) {
  useReportOrdersClosed();
  // The checkout page shows its own (inline) notice next to the disabled button.
  if (usePathname() === "/checkout") return null;
  return (
    <div
      role="status"
      data-testid="closed-banner"
      data-floating-ui
      className="pointer-events-none fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 mx-auto max-w-xl"
    >
      <div className="pointer-events-auto flex items-start gap-3 rounded-2xl bg-cheddar-400 px-4 py-3 text-ink shadow-[0_8px_24px_rgba(11,31,58,0.25)]">
        <InfoIcon className="mt-0.5 size-5 shrink-0" />
        <p className="text-sm leading-snug">
          <strong className="font-bold">Por el momento no estamos tomando pedidos.</strong>
          {hours && <span className="mt-0.5 block whitespace-pre-line">{hours}</span>}
        </p>
      </div>
    </div>
  );
}
