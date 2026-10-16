"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { activeNavHref, type NavLink } from "@/lib/caja/nav";

/**
 * Role navigation: a dark rail on desktop (>= 1024 px), a scrolling strip under the top bar on
 * tablets. Links are 48 px tall; the current section is highlighted (and `aria-current`).
 */
export function StaffNav({ links }: { links: NavLink[] }) {
  const pathname = usePathname();
  const current = activeNavHref(pathname, links);
  return (
    <nav
      aria-label="Secciones"
      className="bg-ink lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:self-start lg:sticky lg:top-0 lg:h-dvh"
    >
      <div className="hidden items-center gap-3 px-5 py-5 lg:flex">
        <Image src="/brand/logo-512.webp" alt="" width={40} height={40} className="size-10 rounded-full bg-white" />
        <span className="font-display text-lg leading-tight font-extrabold text-white">The Burger House</span>
      </div>
      <ul className="flex gap-2 overflow-x-auto px-3 py-2 lg:flex-col lg:px-3 lg:py-2">
        {links.map((l) => {
          const active = l.href === current;
          return (
            <li key={l.href} className="shrink-0">
              <Link
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-12 items-center rounded-full px-5 text-base font-bold whitespace-nowrap transition-colors lg:rounded-xl ${
                  active ? "bg-cheddar-400 text-ink" : "text-white/85 hover:bg-white/10 hover:text-white"
                }`}
              >
                {l.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
