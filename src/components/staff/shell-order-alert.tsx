"use client";

import { useState } from "react";
import { SoundToggle } from "@/components/caja/sound-controls";
import { useNewOrderAlert } from "@/components/caja/use-new-order-alert";

/**
 * New web orders of the user's sector, announced on the screens that are NOT the workspace itself (Venta,
 * Mostrador, Rendición): beep (shared sound preference), tab title and a polite live-region message. The
 * workspace pages own their own alert (CajaBoard), so they never mount this one: no double beep. It opens no
 * event stream; the shell's LiveRefresh re-renders the page with the fresh list.
 */
export function ShellOrderAlert({ orders }: { orders: { id: number; number: number; createdAt: string }[] }) {
  // The page's own title is the base: "(2) Venta · The Burger House 828" instead of replacing it.
  const [base] = useState(() => (typeof document === "undefined" ? undefined : document.title));
  const alert = useNewOrderAlert(orders, base);
  return (
    <>
      <SoundToggle on={alert.soundOn} onToggle={alert.toggleSound} />
      <p aria-live="polite" role="status" data-testid="shell-announcer" className="sr-only">
        {alert.announcement}
      </p>
    </>
  );
}
