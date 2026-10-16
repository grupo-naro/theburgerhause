"use client";

import { useEffect, useRef } from "react";
import { shortcutFor, type Shortcut } from "@/lib/pos/shortcuts";

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) return !["checkbox", "radio", "button", "submit"].includes(target.type);
  return false;
}

/**
 * Window-level POS shortcuts (mapping in lib/pos/shortcuts). `enabled=false` (a dialog is open)
 * turns them all off: modal dialogs own the keyboard, and Esc is native.
 */
export function usePosShortcuts(handlers: Record<Shortcut, () => void>, enabled: boolean) {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const action = shortcutFor({
        key: e.key,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        repeat: e.repeat,
        typing: isTyping(e.target),
      });
      if (!action) return;
      e.preventDefault();
      ref.current[action]();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
