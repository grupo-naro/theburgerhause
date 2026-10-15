"use client";

import { useRouter } from "next/navigation";
import { SearchIcon } from "./icons";

/** Header shortcut: scrolls to the search box and focuses it. */
export function SearchButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      aria-label="Buscar en el menú"
      onClick={() => {
        const input = document.getElementById("menu-search");
        if (!input) {
          router.push("/#menu-search");
          return;
        }
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        input.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
        input.focus({ preventScroll: true });
      }}
      className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-white transition-colors hover:bg-white/15 focus-visible:outline-white"
    >
      <SearchIcon className="size-6" />
    </button>
  );
}
