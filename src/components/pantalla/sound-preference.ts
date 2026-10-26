"use client";

import { useSyncExternalStore } from "react";

/**
 * The counter TV's "ding" preference. Its own key (a cashier opening the TV screen in another tab of the same browser
 * keeps her Caja preference), and ON by default: the TV is meant to chime, the switch only mutes it.
 */
export const PANTALLA_SOUND_KEY = "pantalla:sound";
const EVENT = "pantalla:sound-change";

let memory: boolean | null = null;

function read(): boolean {
  try {
    return window.localStorage.getItem(PANTALLA_SOUND_KEY) !== "off";
  } catch {
    return memory ?? true;
  }
}

export function writePantallaSound(on: boolean): void {
  try {
    window.localStorage.setItem(PANTALLA_SOUND_KEY, on ? "on" : "off");
  } catch {
    // storage unavailable: the preference lives only until reload
    memory = on;
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function usePantallaSound(): boolean {
  return useSyncExternalStore(subscribe, read, () => true);
}
