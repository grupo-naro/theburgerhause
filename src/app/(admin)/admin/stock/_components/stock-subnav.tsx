"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/admin/stock", label: "Resumen", exact: true },
  { href: "/admin/stock/consumo", label: "Consumo del día" },
  { href: "/admin/stock/reponer", label: "Reponer stock" },
  { href: "/admin/stock/articulos", label: "Artículos" },
  { href: "/admin/stock/historial", label: "Historial" },
] as const;

/** Sections of Stock: a horizontally scrollable strip of tabs (44 px tall, no page overflow). */
export function StockSubnav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Secciones de stock" className="-mx-4 overflow-x-auto px-4">
      <ul className="flex gap-2 pb-1">
        {LINKS.map((l) => {
          const active = "exact" in l ? pathname === l.href : pathname === l.href || pathname.startsWith(`${l.href}/`);
          return (
            <li key={l.href} className="shrink-0">
              <Link
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold whitespace-nowrap ${
                  active ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-surface text-ink hover:bg-brand-50"
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
