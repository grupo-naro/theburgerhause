"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { detectNewOrders } from "@/lib/caja/new-orders";
import { createBeeper, type Beeper } from "@/lib/caja/sound";
import { WARNING_AFTER_MS } from "@/lib/caja/elapsed";
import { useSoundPreference, writeSoundPreference } from "./sound-preference";
import { useDocumentTitle } from "./use-document-title";

export const FLASH_MS = 4000;
export const REMINDER_MS = 60_000;

type Watched = { id: number; number: number; createdAt: string };
export type SoundHint = "off" | "locked" | null;

/**
 * Everything the cashier perceives when an order arrives: a beep (opt-in), a highlight on the new
 * card (~4 s), the tab title, and a polite live-region message. The FIRST render never alerts.
 */
export function useNewOrderAlert(orders: Watched[]) {
  const soundOn = useSoundPreference();
  const beeper = useRef<Beeper | null>(null);
  const seen = useRef<Set<number> | null>(null);
  const latest = useRef(orders);
  const soundRef = useRef(soundOn);
  const [freshIds, setFreshIds] = useState<ReadonlySet<number>>(new Set());
  const [announcement, setAnnouncement] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [titleAlert, setTitleAlert] = useState(false);

  useEffect(() => {
    latest.current = orders;
    soundRef.current = soundOn;
  });

  const getBeeper = useCallback((): Beeper => (beeper.current ??= createBeeper()), []);

  // New arrivals.
  useEffect(() => {
    const fresh = detectNewOrders(seen.current, orders);
    seen.current = new Set([...(seen.current ?? []), ...orders.map((o) => o.id)]);
    if (fresh.length === 0) return;
    const numbers = orders.filter((o) => fresh.includes(o.id)).map((o) => `#${o.number}`);
    // Timers are intentionally not cleared on the next render: the highlight must expire.
    window.setTimeout(() => {
      setFreshIds((prev) => new Set([...prev, ...fresh]));
      setAnnouncement(`Nuevo pedido ${numbers.join(", ")}`);
      if (!document.hasFocus() || document.hidden) setTitleAlert(true);
    }, 0);
    window.setTimeout(() => {
      setFreshIds((prev) => new Set([...prev].filter((id) => !fresh.includes(id))));
    }, FLASH_MS);
    if (soundRef.current) getBeeper().play("new");
  }, [orders, getBeeper]);

  // The title stops flashing as soon as someone looks at the tab.
  useEffect(() => {
    const seenIt = () => {
      if (!document.hidden) setTitleAlert(false);
    };
    window.addEventListener("focus", seenIt);
    document.addEventListener("visibilitychange", seenIt);
    return () => {
      window.removeEventListener("focus", seenIt);
      document.removeEventListener("visibilitychange", seenIt);
    };
  }, []);
  useDocumentTitle(orders.length, titleAlert);

  // A stored "on" needs one user gesture per page load before the browser lets us play.
  useEffect(() => {
    if (!soundOn) return;
    const b = getBeeper();
    let alive = true;
    // The AudioContext is created lazily INSIDE the first user gesture, never on mount.
    const unlock = () => {
      void b.unlock().then((ok) => {
        if (alive) setUnlocked(ok);
      });
    };
    const events = ["click", "keydown"] as const;
    const onGesture = () => {
      unlock();
      for (const e of events) document.removeEventListener(e, onGesture, true);
    };
    for (const e of events) document.addEventListener(e, onGesture, true);
    return () => {
      alive = false;
      for (const e of events) document.removeEventListener(e, onGesture, true);
    };
  }, [soundOn, getBeeper]);

  // Soft reminder while something has been waiting more than 5 minutes.
  useEffect(() => {
    if (!soundOn) return;
    const id = window.setInterval(() => {
      const t = Date.now();
      const stale = latest.current.some((o) => t - Date.parse(o.createdAt) > WARNING_AFTER_MS);
      if (stale) getBeeper().play("reminder");
    }, REMINDER_MS);
    return () => window.clearInterval(id);
  }, [soundOn, getBeeper]);

  const toggleSound = useCallback(async () => {
    if (soundRef.current) {
      writeSoundPreference(false);
      setUnlocked(false);
      return;
    }
    const b = getBeeper();
    const ok = await b.unlock();
    writeSoundPreference(true);
    setUnlocked(ok);
    if (ok) b.play("confirm");
  }, [getBeeper]);

  const hint: SoundHint = !soundOn ? (orders.length > 0 ? "off" : null) : unlocked ? null : "locked";

  return { freshIds, announcement, soundOn, toggleSound, hint };
}
