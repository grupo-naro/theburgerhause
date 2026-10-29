"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { ORDER_STATUSES, type OrderStatus } from "@/domain/order-status";
import { createPoller, type PaymentStatus, type PollResult } from "@/lib/orders/poller";

const isStatus = (v: unknown): v is OrderStatus => (ORDER_STATUSES as readonly unknown[]).includes(v);
const isPayment = (v: unknown): v is PaymentStatus => v === "pending" || v === "paid";

/**
 * Invisible: keeps the server-rendered page fresh. The policy (interval, visibility, backoff, stop
 * conditions) lives in lib/orders/poller; this only wires it to fetch, timers and the router.
 * The page stays the source of truth: a change just triggers `router.refresh()`.
 */
export function StatusPoller({
  token,
  status,
  paymentStatus,
  updatedAt,
}: {
  token: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  updatedAt: string;
}) {
  const router = useRouter();

  useEffect(() => {
    const controller = new AbortController();
    const poller = createPoller({
      initial: { status, paymentStatus, updatedAt },
      isVisible: () => document.visibilityState === "visible",
      schedule: (fn, ms) => window.setTimeout(fn, ms),
      cancel: (handle) => window.clearTimeout(handle as number),
      onChange: () => router.refresh(),
      async fetchStatus(): Promise<PollResult> {
        const res = await fetch(`/api/pedido/${token}/status`, {
          cache: "no-store",
          credentials: "omit",
          referrerPolicy: "no-referrer",
          signal: controller.signal,
        });
        if (res.status === 404) return { kind: "gone" };
        if (!res.ok) return { kind: "error" };
        const body: unknown = await res.json();
        const b = body as { status?: unknown; paymentStatus?: unknown; updatedAt?: unknown };
        if (!isStatus(b.status) || !isPayment(b.paymentStatus)) return { kind: "error" };
        return {
          kind: "ok",
          status: b.status, paymentStatus: b.paymentStatus,
          updatedAt: typeof b.updatedAt === "string" ? b.updatedAt : undefined,
        };
      },
    });
    const onVisibility = () => poller.visibilityChanged();
    const onOnline = () => poller.online();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    poller.start();
    return () => {
      controller.abort();
      poller.stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
    };
  }, [token, status, paymentStatus, updatedAt, router]);

  return null;
}
