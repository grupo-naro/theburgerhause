"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { Fulfillment } from "@/domain/order-status";
import type { PublicDelay } from "@/lib/delay/public";

const POLL_MS = 60_000;

const isRange = (v: unknown): v is { low: number; high: number } =>
  typeof v === "object" && v !== null && typeof (v as { low?: unknown }).low === "number" && typeof (v as { high?: unknown }).high === "number";

function parse(body: unknown): PublicDelay | null {
  const b = body as Partial<PublicDelay> | null;
  if (!b || !isRange(b.takeaway) || !isRange(b.delivery) || typeof b.delayed !== "boolean") return null;
  return {
    takeaway: { low: b.takeaway.low, high: b.takeaway.high },
    delivery: { low: b.delivery.low, high: b.delivery.high },
    delayed: b.delayed,
  };
}

/** Keeps the last good value: a failed poll changes nothing. Polls only while the tab is visible. */
function useLiveDelay(initial: PublicDelay | null): PublicDelay | null {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;
    const refresh = async () => {
      try {
        const res = await fetch("/api/demora", {
          cache: "no-store",
          credentials: "omit",
          referrerPolicy: "no-referrer",
          signal: controller.signal,
        });
        if (!res.ok) return;
        const next = parse(await res.json());
        if (next) setValue(next);
      } catch {
        // keep the last good value
      }
    };
    const stop = () => {
      window.clearTimeout(timer);
      timer = undefined;
    };
    const loop = () => {
      stop();
      if (document.visibilityState !== "visible") return;
      timer = window.setTimeout(async () => {
        await refresh();
        loop();
      }, POLL_MS);
    };
    const wake = () => {
      if (document.visibilityState !== "visible") return stop();
      void refresh();
      loop();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    loop();
    return () => {
      controller.abort();
      stop();
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
    };
  }, []);
  return value;
}

/**
 * Estimated wait, never the reason. `menu` shows both ranges (storefront); `order` shows the one
 * for this order's fulfillment ("Tu pedido"; the page decides when to hide it).
 */
export function EstimateNotice({
  initial,
  variant,
  fulfillment,
}: {
  initial: PublicDelay | null;
  variant: "menu" | "order";
  fulfillment?: Fulfillment;
}) {
  const pathname = usePathname();
  const delay = useLiveDelay(initial);
  if (!delay) return null;
  if (variant === "menu" && (pathname.startsWith("/pedido") || pathname === "/checkout")) return null;

  const tone = delay.delayed ? "border-orange-300 bg-orange-100 text-orange-900" : "border-line bg-surface text-ink-muted";
  const range = (r: { low: number; high: number }) => `${r.low}–${r.high} min`;

  return (
    <div
      role="status"
      data-testid="estimate-notice"
      data-variant={variant}
      data-delayed={delay.delayed ? "true" : "false"}
      className={`rounded-xl border px-3 py-2 text-sm font-semibold leading-snug ${tone} ${variant === "menu" ? "mx-auto mt-2 w-[calc(100%-2rem)] max-w-[1100px] text-center" : ""}`}
    >
      {variant === "menu" ? (
        <>
          Retiro {range(delay.takeaway)} · Delivery {range(delay.delivery)}
        </>
      ) : (
        <>
          Tu pedido llega en aprox. {range(fulfillment === "delivery" ? delay.delivery : delay.takeaway)}
          {delay.delayed && " (hay más demora de lo normal)"}
        </>
      )}
    </div>
  );
}
