"use client";

import { useEffect, useRef } from "react";
import { InfoIcon } from "./icons";
import { useReportOrdersClosed } from "./store-status";

/** Sticky "not taking orders" notice. Publishes its height in --banner-h so the category bar sticks below it. */
export function ClosedNotice({ hours }: { hours: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useReportOrdersClosed();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const sync = () => root.style.setProperty("--banner-h", `${el.offsetHeight}px`);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--banner-h");
    };
  }, []);

  return (
    <div
      ref={ref}
      role="status"
      data-testid="closed-banner"
      className="sticky top-[var(--header-h)] z-30 bg-cheddar-400 text-ink shadow-sm"
    >
      <div className="mx-auto flex max-w-[1100px] items-start gap-3 px-4 py-2.5">
        <InfoIcon className="mt-0.5 size-5 shrink-0" />
        <p className="text-sm leading-snug">
          <strong className="font-bold">Por el momento no estamos tomando pedidos.</strong>
          {hours && <span className="block sm:ml-2 sm:inline">{hours}</span>}
        </p>
      </div>
    </div>
  );
}
