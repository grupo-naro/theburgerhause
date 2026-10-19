"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/lib/auth/roles";

type AdminLink = { href: string; label: string; adminOnly?: true };

const ADMIN_LINKS: readonly AdminLink[] = [
  { href: "/admin/menu", label: "Menú" },
  { href: "/admin/modificadores", label: "Modificadores" },
  { href: "/admin/cadetes", label: "Cadetes" },
  { href: "/admin/usuarios", label: "Usuarios", adminOnly: true },
  { href: "/admin/estaciones", label: "Estaciones", adminOnly: true },
  { href: "/admin/ajustes", label: "Ajustes", adminOnly: true },
];

/** The sections a role sees: the encargado manages menu, modifiers and cadets; users, stations and settings are admin only. */
export function adminLinksFor(role: Role): readonly { href: string; label: string }[] {
  return ADMIN_LINKS.filter((l) => !l.adminOnly || role === "admin").map(({ href, label }) => ({ href, label }));
}

/** Sidebar on desktop; horizontal scroller on mobile. Highlights the current section. */
export function AdminNav({ role }: { role: Role }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Administración" className="hidden border-b border-line bg-surface md:block md:w-56 md:shrink-0 md:border-r md:border-b-0">
      <ul className="flex gap-1 overflow-x-auto px-2 py-2 md:flex-col md:px-3 md:py-4">
        {adminLinksFor(role).map((l) => {
          const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
          return (
            <li key={l.href} className="shrink-0">
              <Link
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`block rounded-full px-4 py-2 text-sm font-semibold whitespace-nowrap md:rounded-xl ${
                  active ? "bg-brand-600 text-white" : "text-ink hover:bg-brand-50"
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
