"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Client navigations do not update `document.referrer`, so "Seguir pidiendo" cannot tell whether
 * the previous history entry was the home page. This tiny tracker (mounted once in the layout)
 * remembers the page we came from for in-app navigations.
 */
let current: string | null = null;
let previous: string | null = null;

export function PreviousPathTracker() {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname === current) return;
    previous = current;
    current = pathname;
  }, [pathname]);
  return null;
}

/** Path of the page visited right before the current one (null after a full page load). */
export function getPreviousPath(): string | null {
  return previous;
}
