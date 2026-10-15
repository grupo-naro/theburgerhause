"use client";

import { useSyncExternalStore } from "react";

export const SOUND_KEY = "caja:sound";
const EVENT = "caja:sound-change";

function read(): boolean {
  try {
    return window.localStorage.getItem(SOUND_KEY) === "on";
  } catch {
    return false;
  }
}

export function writeSoundPreference(on: boolean): void {
  try {
    window.localStorage.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {
    // storage unavailable: the preference lives only until reload
    memory = on;
  }
  window.dispatchEvent(new Event(EVENT));
}

let memory: boolean | null = null;

function subscribe(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

/** The persisted "sound on" preference (default OFF: browsers block audio until a click). */
export function useSoundPreference(): boolean {
  return useSyncExternalStore(subscribe, () => memory ?? read(), () => false);
}
