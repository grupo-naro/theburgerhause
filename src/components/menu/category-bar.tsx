"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { sectionId } from "@/lib/menu/section-id";

type Chip = { slug: string; name: string };

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Sticky category chips with scrollspy. The active chip follows the section
 * crossing a 1px line just below the sticky chrome (IntersectionObserver),
 * and scrolls itself into view horizontally.
 */
export function CategoryBar({ categories }: { categories: Chip[] }) {
  const slugKey = categories.map((c) => c.slug).join("|");
  const [spy, setSpy] = useState(categories[0].slug);
  const active = categories.some((c) => c.slug === spy) ? spy : categories[0].slug;

  const navRef = useRef<HTMLElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const lockedRef = useRef(false);
  const unlockTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Scrollspy.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const slugs = slugKey.split("|");
    const chromeBottom = () => parseFloat(getComputedStyle(nav).top) + nav.offsetHeight;

    const pick = (): string => {
      const atBottom =
        window.scrollY > 0 && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      if (atBottom) return slugs[slugs.length - 1];
      const line = chromeBottom() + 24;
      let current = slugs[0];
      for (const slug of slugs) {
        const el = document.getElementById(sectionId(slug));
        if (el && el.getBoundingClientRect().top <= line) current = slug;
      }
      return current;
    };
    const sync = () => {
      if (!lockedRef.current) setSpy(pick());
    };

    let io: IntersectionObserver | undefined;
    const observe = () => {
      io?.disconnect();
      const line = Math.round(chromeBottom() + 24);
      const bottom = Math.max(window.innerHeight - line - 1, 0);
      io = new IntersectionObserver(sync, { rootMargin: `-${line}px 0px -${bottom}px 0px` });
      for (const slug of slugs) {
        const el = document.getElementById(sectionId(slug));
        if (el) io.observe(el);
      }
    };

    observe();
    window.addEventListener("resize", observe);
    window.addEventListener("scroll", sync, { passive: true });
    return () => {
      io?.disconnect();
      window.removeEventListener("resize", observe);
      window.removeEventListener("scroll", sync);
    };
  }, [slugKey]);

  // Keep the active chip visible in the horizontal strip.
  useEffect(() => {
    const scroller = scrollerRef.current;
    const chip = scroller?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!scroller || !chip) return;
    scroller.scrollTo({
      left: chip.offsetLeft - (scroller.clientWidth - chip.offsetWidth) / 2,
      behavior: reducedMotion() ? "auto" : "smooth",
    });
  }, [active]);

  useEffect(() => () => clearTimeout(unlockTimer.current), []);

  const go = (e: MouseEvent<HTMLAnchorElement>, slug: string) => {
    const target = document.getElementById(sectionId(slug));
    if (!target) return;
    e.preventDefault();
    setSpy(slug);
    // Hold the spy while the programmatic scroll runs so the chip does not flicker.
    lockedRef.current = true;
    const unlock = () => {
      lockedRef.current = false;
      clearTimeout(unlockTimer.current);
      window.removeEventListener("scrollend", unlock);
    };
    clearTimeout(unlockTimer.current);
    window.addEventListener("scrollend", unlock, { once: true });
    unlockTimer.current = setTimeout(unlock, 1200);
    target.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
  };

  return (
    <nav
      ref={navRef}
      aria-label="Categorías del menú"
      className="sticky top-[var(--header-h)] z-20 h-[var(--bar-h)] border-b border-line bg-bg/95 backdrop-blur"
    >
      <div
        ref={scrollerRef}
        className="no-scrollbar relative mx-auto flex h-full max-w-[1100px] snap-x scroll-px-4 items-center gap-2 overflow-x-auto px-4"
      >
        {categories.map((c) => {
          const current = c.slug === active;
          return (
            <a
              key={c.slug}
              href={`#${sectionId(c.slug)}`}
              onClick={(e) => go(e, c.slug)}
              aria-current={current ? "true" : undefined}
              className={`inline-flex h-11 shrink-0 snap-start items-center whitespace-nowrap rounded-full border px-4 text-[15px] font-bold transition-colors ${
                current
                  ? "border-brand-600 bg-brand-600 text-white shadow-sm"
                  : "border-brand-300/50 bg-brand-50 text-brand-700 hover:border-brand-300 hover:bg-white"
              }`}
            >
              {c.name}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
