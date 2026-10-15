"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { getPreviousPath } from "./previous-path";

/**
 * "Seguir pidiendo": back to the menu. When the previous history entry IS the home page we go back
 * (the browser restores its scroll position); otherwise a plain link to "/".
 */
export function ContinueShopping({ className }: { className?: string }) {
  const router = useRouter();
  return (
    <Link
      href="/"
      className={className}
      onClick={(e) => {
        if (getPreviousPath() === "/" && window.history.length > 1) {
          e.preventDefault();
          router.back();
        }
      }}
    >
      Seguir pidiendo
    </Link>
  );
}
