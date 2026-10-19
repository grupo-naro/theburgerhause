"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { buttonClass } from "./button";

/**
 * "⋯" disclosure holding the secondary actions of a card. Closes on Escape (focus returns to the
 * trigger), on a tap outside, and when focus leaves the menu. Children are the items (ActionButton / Link).
 */
export function OverflowMenu({
  label,
  children,
  align = "end",
}: {
  label: string;
  children: ReactNode;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node))
        setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="relative"
      onBlur={(e) => {
        if (
          open &&
          !e.currentTarget.contains(e.relatedTarget as Node | null) &&
          e.relatedTarget !== null
        )
          setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className={`${buttonClass("secondary")} min-h-11 min-w-11 px-3! py-1! text-xl leading-none`}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      <div
        id={panelId}
        className={`${open ? "flex" : "hidden"} absolute top-full z-10 mt-1 min-w-48 flex-col gap-2 rounded-2xl border border-line bg-surface p-2 shadow-lg ${
          align === "end" ? "right-0" : "left-0"
        } [&_button]:w-full [&_form]:flex [&_form]:w-full [&_a]:w-full`}
        onClick={(e) => {
          // The panel stays mounted (just hidden) so a submitted form keeps its pending state; close after the click settles.
          if ((e.target as HTMLElement).closest("button, a"))
            setTimeout(() => {
              setOpen(false);
              if (!(e.target as HTMLElement).closest("a"))
                triggerRef.current?.focus();
            }, 0);
        }}
      >
        {children}
      </div>
    </div>
  );
}
