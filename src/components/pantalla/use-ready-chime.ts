"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createBeeper, type Beeper } from "@/lib/caja/sound";
import { newlyReady } from "@/lib/pantalla/ready-transitions";
import { usePantallaSound, writePantallaSound } from "./sound-preference";

/** How long a number that just became ready stays highlighted. */
export const HIGHLIGHT_MS = 8000;
/** Two orders ready at once: one ding each, slightly apart so both are heard. */
const DING_GAP_MS = 700;

/**
 * The counter TV's "ding" + highlight. An order chimes the FIRST time it moves from "En preparación" to "¡Listo!"
 * (seen on this screen); going back to preparation and being ready again does not chime twice, and neither does the
 * listo_despacho -> para_retirar step. The first render never chimes (the screen was just opened).
 *
 * Browsers only play audio after a user gesture: until the first touch/click/key on the page the hook reports
 * `locked` (the screen shows a discreet hint). The AudioContext is created inside that gesture, never on mount.
 */
export function useReadyChime(preparing: number[], ready: number[]) {
  const soundOn = usePantallaSound();
  const beeper = useRef<Beeper | null>(null);
  const prev = useRef<{ preparing: number[]; ready: number[] } | null>(null);
  const chimed = useRef<Set<number>>(new Set());
  const soundRef = useRef(soundOn);
  const [highlighted, setHighlighted] = useState<ReadonlySet<number>>(new Set());
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    soundRef.current = soundOn;
  });

  const getBeeper = useCallback((): Beeper => (beeper.current ??= createBeeper()), []);

  const preparingKey = preparing.join(",");
  const readyKey = ready.join(",");
  useEffect(() => {
    const nowPreparing = preparingKey ? preparingKey.split(",").map(Number) : [];
    const nowReady = readyKey ? readyKey.split(",").map(Number) : [];
    const before = prev.current;
    prev.current = { preparing: nowPreparing, ready: nowReady };
    if (before === null) return;
    const fresh = newlyReady(before.ready, nowReady, before.preparing).filter((id) => !chimed.current.has(id));
    if (fresh.length === 0) return;
    for (const id of fresh) chimed.current.add(id);
    // Timers are intentionally not cleared on the next render: the highlight must expire.
    window.setTimeout(() => setHighlighted((h) => new Set([...h, ...fresh])), 0);
    window.setTimeout(() => setHighlighted((h) => new Set([...h].filter((id) => !fresh.includes(id)))), HIGHLIGHT_MS);
    if (soundRef.current) {
      fresh.forEach((_, i) => window.setTimeout(() => getBeeper().play("ready"), i * DING_GAP_MS));
    }
  }, [preparingKey, readyKey, getBeeper]);

  // The first gesture anywhere on the page unlocks the audio (one per page load).
  useEffect(() => {
    if (!soundOn || unlocked) return;
    let alive = true;
    const events = ["pointerdown", "click", "keydown", "touchstart"] as const;
    const onGesture = () => {
      for (const e of events) document.removeEventListener(e, onGesture, true);
      void getBeeper()
        .unlock()
        .then((ok) => {
          if (alive) setUnlocked(ok);
        });
    };
    for (const e of events) document.addEventListener(e, onGesture, true);
    return () => {
      alive = false;
      for (const e of events) document.removeEventListener(e, onGesture, true);
    };
  }, [soundOn, unlocked, getBeeper]);

  const toggleSound = useCallback(async () => {
    if (soundRef.current) {
      writePantallaSound(false);
      return;
    }
    writePantallaSound(true);
    const b = getBeeper();
    const ok = await b.unlock();
    setUnlocked(ok);
    if (ok) b.play("confirm");
  }, [getBeeper]);

  /** "locked": sound is wanted but the browser still needs the first touch. */
  const hint: "locked" | null = soundOn && !unlocked ? "locked" : null;

  return { highlighted, soundOn, toggleSound, hint };
}
